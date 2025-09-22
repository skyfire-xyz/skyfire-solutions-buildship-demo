import React, {
  createContext,
  useContext,
  useState,
  ReactNode,
  useEffect,
} from "react";

import { AgentContext, AppContextType } from "@/lib/types";

const AppContext = createContext<AppContextType | undefined>(undefined);

export function AppProvider({ children }: { children: ReactNode }) {
  const [apiKey, setApiKey] = useState<string>(() => {
    if (typeof window !== "undefined") {
      return sessionStorage.getItem("skyfire_api_key") || process.env.SKYFIRE_API_KEY || "";
    }
    return process.env.SKYFIRE_API_KEY || "";
  });

  const [agentContext, setAgentContext] = useState<AgentContext>(() => {
    return {
      available_mcp_servers: [],
      dynamically_mounted_server: [],
      openApiSpecs: [],
      conversation_history: []
    };
  });

  const [redisConnected, setRedisConnected] = useState<boolean>(true);
  const [redisError, setRedisError] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window !== "undefined" && apiKey) {
      sessionStorage.setItem("skyfire_api_key", apiKey);
    }
  }, [apiKey]);


  const value: AppContextType = {
    apiKey,
    setApiKey,
    agentContext,
    setAgentContext,
    redisConnected,
    setRedisConnected,
    redisError,
    setRedisError
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppContextType {
  const context = useContext(AppContext);
  if (context === undefined) {
    throw new Error("useApp must be used within an AppProvider");
  }
  return context;
}
