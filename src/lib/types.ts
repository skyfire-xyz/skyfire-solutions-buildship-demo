import { z } from "zod";
import { CoreMessage, Message } from "ai";

export type AppContextType = {
  apiKey: string;
  setApiKey: (apiKey: string) => void;
  agentContext: AgentContext;
  setAgentContext: (agentContext: AgentContext) => void;
  redisConnected: boolean;
  setRedisConnected: (connected: boolean) => void;
  redisError: string | null;
  setRedisError: (error: string | null) => void;
};

export type AgentPattern =
  | "sequential"
  | "routing"
  | "parallel"
  | "orchestrator"
  | "evaluator";

export interface InputField {
  name: string;
  type: "textarea" | "input";
  label: string;
  placeholder: string;
}

export interface AgentContext {
  available_mcp_servers: Array<{
    url: string;
    headers: Record<string, string>;
  }>;
  dynamically_mounted_server: Array<{
    url: string;
    headers: Record<string, string>;
  }>;
  openApiSpecs: Array<{
    url: string;
    authHeader?: string;
  }>;
  conversation_history: CoreMessage[];
}

export interface AgentType {
  name: string;
  id: string;
  description: string;
  input: string;
  output: string;
  parameter: string;
  context: string;
  inputFields: InputField[];
  resultTabs: string[];
  systemPrompt?: string;
  tools?: Array<{ name: string; description: string }>;
  steps?: string[];
  routes?: string[];
  workers?: string[];
  phases?: string[];
  maxIterations?: number;
  averageTime?: number;
  capabilities?: string[];
}

export interface AgentConfig {
  pattern: AgentPattern;
  maxSteps: number;
  model: string;
  temperature: number;
}

export interface AgentResult {
  text: string;
  steps: AgentStep[];
  toolCalls: ToolCall[];
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  error?: boolean;
  message?: string;
}

export interface AgentStep {
  text: string;
  toolCalls?: ToolCall[];
  toolResults?: unknown[];
  finishReason: string;
}

export interface ModelParams {
  modelId: string;
  maxTokens: number;
  temperature: number;
}

export interface ToolCall {
  type: string;
  toolName: string;
  args: Record<string, unknown>;
  result?: unknown;
}

export type AgentResponse = string | { images: unknown[]; error: Error };

export type ExamplePrompt = {
  name?: string;
  label?: string;
  prompt?: string;
  content?: string;
  query?: string;
  requirements?: string;
  [key: string]: string | undefined;
};

export interface FormattedStep {
  step: number;
  text: string;
  tool: string;
  input: Record<string, any>;
  result: any;
}

export const DEMO_PROMPT = "Conduct company and competitor research on Visa and return a report with your findings.";

export const agentConfigSchema = z.object({
  pattern: z.enum([
    "sequential",
    "routing",
    "parallel",
    "orchestrator",
    "evaluator",
  ]),
  maxSteps: z.number().min(1).max(20),
  model: z.string(),
  temperature: z.number().min(0).max(2),
});

export const agentResultSchema = z.object({
  text: z.string(),
  steps: z.array(
    z.object({
      text: z.string(),
      toolCalls: z
        .array(
          z.object({
            type: z.string(),
            name: z.string(),
            parameters: z.record(z.unknown()),
            result: z.unknown().optional(),
          })
        )
        .optional(),
      toolResults: z.array(z.unknown()).optional(),
      finishReason: z.string(),
    })
  ),
  toolCalls: z.array(
    z.object({
      type: z.string(),
      name: z.string(),
      parameters: z.record(z.unknown()),
      result: z.unknown().optional(),
    })
  ),
  usage: z.object({
    promptTokens: z.number(),
    completionTokens: z.number(),
    totalTokens: z.number(),
  }),
});

export const agentTypes = [
  {
    name: "Skyfire Commerce Agent",
    id: "multi-step-tool-usage",
    description:
      "An autonomous agent designed for secure B2B data commerce. It discovers data sellers, verifies offerings, handles authentication (including Skyfire KYA tokens), executes payments via Skyfire, retrieves data, and can integrate it into analyses or reports. Leverages MCP for communication.",
    input: "Detailed problem description in natural language",
    output:
      "Comprehensive solution with step-by-step breakdown, tool usage analysis, and final results",
    parameter: "maxSteps (default: 5, range: 3-10)",
    context:
      "Perfect for complex scenarios requiring systematic breakdown and specialized tools",
    inputFields: [
      {
        name: "prompt",
        type: "textarea" as const,
        label: "Purchase Intent",
        placeholder: ``,
        // Describe your purchase in detail. The agent will discover products and services from vendors, finding the right items that match your criteria and handle the transaction securely.\n\nExample purchases:\n\n1. Data Analysis:\n   "I need market research data for the electric vehicle industry in Europe:\n   - Time period: Last 5 years\n   - Geographic focus: Germany, France, UK\n   - Data points: Sales volumes, market share, pricing trends\n   - Format: CSV or Excel\n   - Budget: $2,500"\n\n2. API Access:\n   "Looking for real-time weather data API:\n   - Global coverage required\n   - Update frequency: Every 15 minutes\n   - Historical data: 5 years\n   - SLA: 99.9% uptime\n   - Budget: $1,000/month"\n\n3. Business Intelligence:\n   "Seeking competitive intelligence data for retail sector:\n   - Competitor pricing and promotions\n   - Store location analytics\n   - Customer demographic insights\n   - Data refresh: Weekly\n   - Budget: $5,000"
      },
    ],
    resultTabs: ["response", "steps", "tools"],
    systemPrompt: `<setup>
You are connected to tools from MCP servers (sse) and hosted OpenAPI specs (jsons)
and are solving problems step by step. To use an OpenAPI spec can do and convert it to a tool, use the convertOpenApiSpecToAgentTool tool.
Make sure to inlcude the openapi.json at the end of urls
</setup>

<procedures>
Remember to use only the create-kya-pay-token tool from skyfire before using an external service tool call
</procedures>

 MCP servers have /sse at the end, if it's a json then you would connect via the OpenAPI tool.
<terminate>
When connect-mcp-server-tool tool is executed, stop the processing immediately.
You can execute multiple convert-openapi-spec-to-agent-tool calls in sequence, but after all OpenAPI conversions are complete, stop processing.
</terminate>

Pass in headers skyfire_kya_pay_token with value as the pay token for openapi tool calls.`,
    tools: [
      {
        name: "skyfire-identity-payment",
        description: "Skyfire Identity & Payment MCP Server",
      },
      {
        name: "carbonarc-seller",
        description: "CarbonArc MCP Server",
      },
    ],
    capabilities: [
      "Agent-to-agent commerce",
      "Data discovery (via Seller API)",
      "Data purchasing",
      "Skyfire payment execution (v1 & v2)",
      "Skyfire KYA token usage (v2+)",
      "MCP client communication",
      "Interaction with remote Seller APIs",
      "Secure file download and extraction",
      "Data integration into documents/presentations",
      "Automated multi-step workflow execution",
      "Credential management (API Keys, potentially username/password, OAuth)",
      "Transaction tracking",
      "Account creation via Seller API (v3+)",
    ],
    steps: [
      "Parse Task & Plan Execution",
      "Discover Seller & Service (via Search or Config)",
      "Identify Dataset & Get Pricing (via Seller API)",
      "Perform Authentication/Verification (Skyfire KYA, Login - as needed)",
      "Check Funds / Prepare Payment (via Skyfire API)",
      "Execute Purchase & Payment (via Seller & Skyfire APIs)",
      "Retrieve & Process Data (Download, Unzip)",
      "Integrate Data / Update Output (e.g., Presentation)",
      "Report Completion & Results",
    ],
    averageTime: 80,
  },
] as const satisfies AgentType[];

export const examplePrompts = {
  "multi-step-tool-usage": [
    {
      name: "Conduct Research on Visa Inc.",
      prompt: `Conduct company and competitor research on Visa and return a report with your findings.`,
    }
  ],
};
