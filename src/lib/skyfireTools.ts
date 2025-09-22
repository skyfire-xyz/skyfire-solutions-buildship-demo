import { jsonSchema } from "ai";

export const connectMcpServerTool = {
    "connect-mcp-server-tool": {
      description: "Connects to the seller MCP server sse URL.",
      parameters: jsonSchema({
        type: "object",
        properties: {
          mcpServerUrl: {
            type: "string",
            description: "URL for seller MCP server",
          },
          sellerName: {
            type: "string",
            description: "Name of the seller",
          }
        },
        required: ["mcpServerUrl", "sellerName"],
        additionalProperties: false,
      }),
      execute: async () => {
        return {
          content: [
            {
              type: "text",
              text: "Connecting to Seller MCP server....",
            },
          ],
        };
      },
    },
  };

export const convertOpenApiSpecToAgentTool = {
    "convert-openapi-spec-to-agent-tool": {
        description: "Gets the OpenAPI spec URL prompted by the user. Stop execution after this tool",
        parameters: jsonSchema({
        type: "object",
        properties: {
            openApiSpecUrl: {
            type: "string",
            description: "URL for OpenAPI spec - ends in a .json",
            },
            serviceName: {
            type: "string",
            description: "Name of the service corresponding to the OpenAPI spec",
            }
        },
        required: ["openApiSpecUrl", "serviceName"],
        additionalProperties: false,
        }),
        execute: async () => {
        return {
          content: [
            {
              text:  "Converting OpenAPI spec to tools...",
            },
          ],
        };
        },
    },
};