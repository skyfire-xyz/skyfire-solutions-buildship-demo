import { jsonSchema } from "ai";
import type { OpenAPIV3_1 } from "openapi-types";

interface ToolDefinition {
  description: string;
  parameters: ReturnType<typeof jsonSchema>;
  execute: (...args: any[]) => Promise<any>;
}

interface Tools {
  [toolName: string]: ToolDefinition;
}

interface SecurityScheme {
  type: string;
  scheme?: string;
  bearerFormat?: string;
  in?: string;
  name?: string;
}

/**
 * OpenAPI to Tools Converter
 * 
 * This module converts OpenAPI specifications into runnable tools for the agent.
 * Based on the Python implementation reference.
 */
export class OpenAPIToTools {
  private spec: OpenAPIV3_1.Document;
  private baseUrl: string;
  private apiKey: string;
  private securitySchemes: Record<string, SecurityScheme>;
  private toolNames: Record<string, string>;

  constructor(spec: OpenAPIV3_1.Document, apiKey: string = "") {
    this.spec = spec;
    this.baseUrl = this.getBaseUrl();
    this.apiKey = apiKey;
    this.securitySchemes = this.extractSecuritySchemes();
    this.toolNames = this.extractToolNames();
  }

  private getBaseUrl(): string {
    if (this.spec.servers && this.spec.servers.length > 0) {
      return this.spec.servers[0].url;
    }
    return '';
  }

  private extractSecuritySchemes(): Record<string, SecurityScheme> {
    const schemes: Record<string, SecurityScheme> = {};

    if (this.spec.components?.securitySchemes) {
      Object.entries(this.spec.components.securitySchemes).forEach(([key, scheme]) => {
        schemes[key] = scheme as SecurityScheme;
      });
    }

    return schemes;
  }

  private extractToolNames(): Record<string, string> {
    const toolNames: Record<string, string> = {};
    
    if (this.spec.paths) {
      Object.entries(this.spec.paths).forEach(([path, pathItem]) => {
        if (!pathItem || typeof pathItem !== "object") return;
        const methods = ["get", "post", "put", "delete", "patch"];
        methods.forEach((method) => {
          const operation = (pathItem as Record<string, unknown>)[method];
          if (
            operation &&
            typeof operation === "object" &&
            "summary" in operation
          ) {
            const toolKey = `${method}_${path}`;
            toolNames[toolKey] = String(operation.summary)
              .toLowerCase()
              .replace(/[^a-z0-9]/g, "_");
          }
        });
      });
    }

    return toolNames;
  }

  private getSecurityHeaders(operation: OpenAPIV3_1.OperationObject): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    // Only add security headers if we have an API key
    if (!this.apiKey) {
      return headers;
    }

    const securityRequirements = operation.security || this.spec.security || [];

    securityRequirements.forEach(requirement => {
      Object.entries(requirement).forEach(([schemeName, scopes]) => {
        const scheme = this.securitySchemes[schemeName];

        if (scheme) {
          switch (scheme.type) {
            case 'http':
              if (scheme.scheme === 'bearer') {
                headers['Authorization'] = `Bearer ${this.apiKey}`;
              } else if (scheme.scheme === 'basic') {
                // Handle basic auth if needed
                const credentials = Buffer.from(this.apiKey).toString('base64');
                headers['Authorization'] = `Basic ${credentials}`;
              }
              break;

            case 'apiKey':
              if (scheme.in === 'header') {
                headers[scheme.name!] = this.apiKey;
              }
              break;

            case 'oauth2':
              // Handle OAuth2 if needed
              headers['Authorization'] = `Bearer ${this.apiKey}`;
              break;
          }
        }
      });
    });

    return headers;
  }

  private convertParameterToJsonSchema(parameter: OpenAPIV3_1.ParameterObject) {
    const paramSchema = parameter.schema;
    
    // Handle both SchemaObject and ReferenceObject
    const schemaObj = paramSchema && '$ref' in paramSchema ? {} : paramSchema as OpenAPIV3_1.SchemaObject;
    
    const schema: any = {
      type: schemaObj?.type || 'string',
      description: parameter.description || `Parameter ${parameter.name}`,
    };

    // Add optional properties if they exist
    if (schemaObj?.format) schema.format = schemaObj.format;
    if (schemaObj?.default !== undefined) schema.default = schemaObj.default;
    if (schemaObj?.minimum !== undefined) schema.minimum = schemaObj.minimum;
    if (schemaObj?.maximum !== undefined) schema.maximum = schemaObj.maximum;
    if (schemaObj?.enum) schema.enum = schemaObj.enum;

    return schema;
  }

  private convertRequestBodyToJsonSchema(requestBody: OpenAPIV3_1.RequestBodyObject) {
    const content = requestBody.content || {};
    const jsonContent = content['application/json'];

    if (!jsonContent) {
      return null;
    }

    const schema = jsonContent.schema;
    // Handle both SchemaObject and ReferenceObject
    const schemaObj = schema && '$ref' in schema ? {} : schema as OpenAPIV3_1.SchemaObject;
    
    if (!schemaObj || schemaObj.type !== 'object') {
      return null;
    }

    const properties: Record<string, any> = {};
    const required: string[] = [];

    // Convert schema properties
    Object.entries(schemaObj.properties || {}).forEach(([key, prop]) => {
      // Handle both SchemaObject and ReferenceObject for properties
      const propObj = prop && '$ref' in prop ? {} : prop as OpenAPIV3_1.SchemaObject;
      
      // Remove nested properties if empty and copy other properties
      const propCopy = { ...propObj };
      if (propCopy.properties && Object.keys(propCopy.properties).length === 0) {
        delete propCopy.properties;
      }

      properties[key] = {
        type: propCopy.type || 'string',
        description: propCopy.title || propCopy.description || `Property ${key}`,
      };

      // Add optional properties
      ['format', 'default', 'minimum', 'maximum', 'enum'].forEach(attr => {
        if (attr in propCopy) {
          properties[key][attr] = (propCopy as any)[attr];
        }
      });
    });

    // Add required fields
    if (schemaObj.required) {
      required.push(...schemaObj.required);
    }

    return {
      type: 'object',
      properties,
      required: required.length > 0 ? required : undefined,
      additionalProperties: false,
    };
  }

  private generateToolName(path: string, method: string, operation: OpenAPIV3_1.OperationObject): string {
    // Check for pre-extracted tool names first
    const toolKey = `${method}_${path}`;
    if (this.toolNames[toolKey]) {
      return this.toolNames[toolKey];
    }

    // Get the summary from the operation
    const summary = operation.summary || '';

    if (summary) {
      // Clean the summary: remove special chars, convert to lowercase, replace spaces with underscores
      let cleanSummary = summary.toLowerCase();
      // Remove special characters and extra whitespace
      cleanSummary = cleanSummary.split(/\s+/).join(' ').trim();
      // Replace spaces with underscores
      cleanSummary = cleanSummary.replace(/\s+/g, '_');
      // Remove any remaining special characters except underscores
      cleanSummary = cleanSummary.replace(/[^a-z0-9_]/g, '');
      
      // If summary is one word, use method_summary format
      if (!cleanSummary.includes('_')) {
        const toolName = `${method.toLowerCase()}_${cleanSummary}`;
        return toolName.substring(0, 60);
      } else {
        // If summary has multiple words, just use the summary
        return cleanSummary.substring(0, 60);
      }
    } else {
      // Fallback to operation ID if available
      const operationId = operation.operationId;
      if (operationId) {
        // Clean operation ID
        const cleanId = operationId.replace(/[\s-]/g, '_').toLowerCase();
        const finalId = cleanId.replace(/[^a-z0-9_]/g, '');
        return `${method.toLowerCase()}_${finalId}`.substring(0, 60);
      }
      
      // Final fallback: use path-based naming
      const pathPart = path
        .replace(/[{}]/g, '')
        .replace(/\//g, '_')
        .replace(/-/g, '_')
        .replace(/^_+|_+$/g, '');
      
      // Remove consecutive underscores and limit length
      let toolName = `${method.toLowerCase()}_${pathPart}`;
      toolName = toolName.split('_').filter(Boolean).join('_');
      
      return toolName.substring(0, 60);
    }
  }

  private createExecuteFunction(
    path: string,
    method: string,
    parameters: OpenAPIV3_1.ParameterObject[],
    operation: OpenAPIV3_1.OperationObject
  ) {
    return async (args: Record<string, any>) => {
      const toolName = this.generateToolName(path, method, operation);

      try {
        let url = this.baseUrl + path;
        const queryParams = new URLSearchParams();

        // Get security headers based on operation
        const headers = this.getSecurityHeaders(operation);

        // Handle skyfire_kya_pay_token parameter - add to headers
        if (args.skyfire_kya_pay_token) {
          headers['skyfire_kya_pay_token'] = args.skyfire_kya_pay_token;
        }

        // Handle parameters
        parameters.forEach(param => {
          const paramName = param.name;
          const paramIn = param.in;
          
          if (paramName in args) {
            if (paramIn === 'path') {
              url = url.replace(`{${paramName}}`, String(args[paramName]));
            } else if (paramIn === 'query') {
              queryParams.append(paramName, String(args[paramName]));
            } else if (paramIn === 'header') {
              headers[paramName] = String(args[paramName]);
            }
          }
        });

        if (queryParams.toString()) {
          url += `?${queryParams.toString()}`;
        }

        // Handle request body for POST/PUT/PATCH methods
        let body: string | undefined;
        if (['post', 'put', 'patch'].includes(method.toLowerCase())) {
          // Extract request body parameters (exclude path, query, header params and headers)
          const bodyParams: Record<string, any> = {};
          const paramNames = parameters.map(p => p.name);
          
          Object.entries(args).forEach(([key, value]) => {
            if (!paramNames.includes(key) && key !== 'skyfire_kya_pay_token' && value !== undefined) {
              bodyParams[key] = value;
            }
          });
          
          if (Object.keys(bodyParams).length > 0) {
            body = JSON.stringify(bodyParams);
          }
        }

        const response = await fetch(url, {
          method: method.toUpperCase(),
          headers,
          body,
        });

        if (!response.ok) {
          let errorMessage: string;
          try {
            const errorData = await response.json();
            errorMessage = errorData.error || response.statusText;
          } catch {
            errorMessage = response.statusText;
          }
          
          console.error(`HTTP error in ${toolName}: ${response.status} - ${errorMessage}`);
          throw new Error(`HTTP error! status: ${response.status}, message: ${errorMessage}`);
        }

        const contentType = response.headers.get('content-type');
        let responseData;
        if (contentType?.includes('application/json')) {
          responseData = await response.json();
        } else {
          responseData = await response.text();
        }

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(responseData, null, 2),
            },
          ],
        };

      } catch (error) {
        console.error(`Error in tool execution (${toolName}):`, error);
        return {
          content: [
            {
              type: "text",
              text: `Error: ${error instanceof Error ? error.message : 'An unknown error occurred'}`,
            },
          ],
        };
      }
    };
  }

  private convertParametersToJsonSchema(
    parameters: OpenAPIV3_1.ParameterObject[],
    requestBody?: OpenAPIV3_1.RequestBodyObject
  ) {
    const properties: Record<string, any> = {};
    const required: string[] = [];

    // Add skyfire_kya_pay_token parameter for authentication
    properties['skyfire_kya_pay_token'] = {
      type: 'string',
      description: 'Skyfire KYA+PAY token for authentication'
    };

    // Add path, query, and header parameters
    parameters.forEach(param => {
      properties[param.name] = this.convertParameterToJsonSchema(param);
      // Path parameters are always required, query/header parameters are required if explicitly marked
      if (param.required || param.in === 'path') {
        required.push(param.name);
      }
    });

    // Add request body parameters if they exist
    if (requestBody) {
      // Process OpenAPI request body structure
      const content = requestBody.content || {};
      const jsonContent = content['application/json'] || {};
      const schema = jsonContent.schema;
      
      // Handle both SchemaObject and ReferenceObject
      const schemaObj = schema && '$ref' in schema ? {} : schema as OpenAPIV3_1.SchemaObject;
      
      if (schemaObj && schemaObj.type === 'object') {
        // Extract properties from the schema
        const schemaProperties = schemaObj.properties || {};
        const schemaRequired = schemaObj.required || [];
        
        Object.entries(schemaProperties).forEach(([propName, propSchema]) => {
          // Handle both SchemaObject and ReferenceObject for properties
          const propObj = propSchema && '$ref' in propSchema ? {} : propSchema as OpenAPIV3_1.SchemaObject;
          
          // Convert OpenAPI property schema to tool parameter schema
          properties[propName] = {
            type: propObj.type || 'string',
            description: propObj.title || propObj.description || `Property ${propName}`,
          };
          
          // Add optional properties if they exist
          ['format', 'default', 'minimum', 'maximum', 'enum'].forEach(attr => {
            if (attr in propObj) {
              properties[propName][attr] = (propObj as any)[attr];
            }
          });
          
          // Add to required list if specified in schema
          if (schemaRequired.includes(propName)) {
            required.push(propName);
          }
        });
        
        // Special handling for malformed required fields like ["string"]
        if (JSON.stringify(schemaRequired) === JSON.stringify(['string'])) {
          console.warn("Detected malformed required field ['string'], using property names instead");
          Object.keys(schemaProperties).forEach(propName => {
            if (!required.includes(propName)) {
              required.push(propName);
            }
          });
        }
      }
    }

    // Ensure required list only contains valid property names
    const validRequired = required.filter(req => req in properties);
    if (validRequired.length !== required.length) {
      console.warn(`Some required fields are not in properties. Required: ${required}, Valid: ${validRequired}`);
    }

    // Make all properties required
    const finalRequired = Object.keys(properties);

    return jsonSchema({
      type: 'object',
      properties,
      required: finalRequired,
      additionalProperties: false,
    });
  }

  public generateTools(): Tools {
    const tools: Tools = {};

    // Iterate through all paths and methods
    Object.entries(this.spec.paths || {}).forEach(([path, pathItem]) => {
      if (!pathItem) return;

      // Handle each HTTP method (get, post, etc.)
      const methods = ['get', 'post', 'put', 'delete', 'patch'] as const;
      methods.forEach(method => {
        const operation = pathItem[method];
        if (!operation) return;

        const toolName = this.generateToolName(path, method, operation);
        const parameters = [
          ...(pathItem.parameters || []),
          ...(operation.parameters || []),
        ] as OpenAPIV3_1.ParameterObject[];

        // Get request body
        const requestBody = operation.requestBody;

        // Create tool description
        let description = operation.summary || operation.description || `${method.toUpperCase()} ${path}`;
        description += " Requires skyfire_kya_pay_token parameter for authentication.";

        const toolSchema = this.convertParametersToJsonSchema(parameters, requestBody as OpenAPIV3_1.RequestBodyObject);
        
        tools[toolName] = {
          description,
          parameters: toolSchema,
          execute: this.createExecuteFunction(path, method, parameters, operation),
        };
      });
    });

    return tools;
  }
}

/**
 * Utility function to create tools from OpenAPI spec
 * 
 * @param spec OpenAPI specification as a dictionary
 * @param apiKey API key for authentication
 * @returns Object containing tool definitions
 */
export function createOpenApiTools(
  spec: OpenAPIV3_1.Document, 
  apiKey: string = ""
): Tools {
  const converter = new OpenAPIToTools(spec, apiKey);
  return converter.generateTools();
}