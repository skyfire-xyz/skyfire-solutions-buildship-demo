"use client";

import { toast } from "sonner";
import { useState, useCallback, useRef } from "react";

import {
  ActionButtons,
  InputPanel,
} from "@/components/agent/agent-input-panel";
import { AgentHeader } from "@/components/agent/agent-header";
import { OutputPanel } from "@/components/agent/agent-output-cards";
import { MobileOutputPanel } from "@/components/agent/agent-mobile-output-panel";

import { getAgent } from "@/app/actions";
import { useApp } from "@/context/app-provider";
import { useMediaQuery } from "@/hooks/use-media-query";
import { agentTypes, examplePrompts, AgentResult, ExamplePrompt, DEMO_PROMPT, FormattedStep } from "@/lib/types";

export function AgentSandbox() {
  const [inputs, setInputs] = useState<Record<string, string>>({
    prompt: DEMO_PROMPT,
  });
  const [selectedExampleIndex, setSelectedExampleIndex] = useState<
    number | null
  >(0);
  const [output, setOutput] = useState("");
  const [loading, setLoading] = useState(false);
  const [parsedOutput, setParsedOutput] = useState<AgentResult | null>(null);
  const [selectedAgent, setSelectedAgent] = useState<
    (typeof agentTypes)[number]["id"]
  >(agentTypes[0].id);
  const [inputHistory, setInputHistory] = useState<Record<string, string[]>>({});
  const [timeline, setTimeline] = useState<FormattedStep[]>([]);
  const [outputDrawerOpen, setOutputDrawerOpen] = useState(false);
  const [hasRunOnce, setHasRunOnce] = useState(false);
  const { apiKey, agentContext, redisConnected, setRedisConnected, redisError, setRedisError } = useApp();
  const stepOffset = useRef(0);

  const isMobile = useMediaQuery("(max-width: 768px)");
  const selectedAgentDetails = agentTypes.find(
    (agent) => agent.id === selectedAgent
  );
  const currentAgentHistory = inputHistory[selectedAgent] || [];

  const handleInputChange = () => {};

  const resetState = useCallback(() => {
    setInputs({ prompt: DEMO_PROMPT });
    setOutput("");
    setLoading(false);
    setParsedOutput(null);
    setSelectedExampleIndex(null);
    setSelectedAgent(agentTypes[0].id);
    setHasRunOnce(false);
  }, []);

  const handleExampleSelect = (example: ExamplePrompt, index: number) => {
    const definedInputs = Object.entries(example)
      .filter(([, value]) => value !== undefined)
      .reduce((acc, [key, value]) => {
        acc[key] = value as string; // Assert value is string after filtering undefined
        return acc;
      }, {} as Record<string, string>);
    setInputs(definedInputs);
    setSelectedExampleIndex(index);
  };

  const handleHistorySelect = (historyItem: string) => {
    try {
      const parsedItem = JSON.parse(historyItem) as Record<string, string>;
      setInputs(parsedItem);
      toast.success("Loaded from history");
    } catch (error) {
      toast.error(`Failed to load history item: ${error}`);
    }
  };

  const runWithPrompt = async (prompt: string) => {
    setLoading(true);
    setHasRunOnce(true);
    setOutputDrawerOpen(true);
    try {
      const result = await getAgent(apiKey, { prompt }, agentContext);

      if (typeof result === "string") {
        setOutput(result);
        try {
          const parsed = JSON.parse(result);
          
          // Handle Redis connection error specifically
          if (parsed.error && parsed.redisError) {
            setRedisConnected(false);
            setRedisError(parsed.message || 'Redis connection failed');
            const formattedMessage = `🚫 Redis Connection Error: ${parsed.message}`;
            parsed.message = formattedMessage;
            parsed.text = formattedMessage;
          }
          // Handle daily limit error specifically
          else if (parsed.error && parsed.message && parsed.message.includes("Daily run limit exceeded")) {
            const tomorrow = new Date();
            tomorrow.setDate(tomorrow.getDate() + 1);
            tomorrow.setHours(0, 0, 0, 0);
            // const timeUntilTomorrow = tomorrow.getTime() - new Date().getTime();
            // const hoursUntilTomorrow = Math.ceil(timeUntilTomorrow / (1000 * 60 * 60));
            
            const formattedMessage = `🚫 Daily run limit reached! Demo has been run ${parsed.dailyCap || 250} times today. Try again tomorrow!`;
            parsed.message = formattedMessage;
            parsed.text = formattedMessage; // Ensure the text field is set for display
          }
          
          setParsedOutput(parsed);
          setTimeline((prev) => {
            const prevSteps: FormattedStep[] = prev ?? [];
            const promptStep: FormattedStep = {
              step: -1,
              text: prompt,
              tool: "prompt",
              input: {},
              result: null,
            };

              const newAgentSteps: FormattedStep[] = (parsed.steps ?? []).map((s: FormattedStep, i: number) => ({
                  ...s,
                  step: stepOffset.current + i + 1,
                }));

                if (newAgentSteps.length > 0) {
                  stepOffset.current =
                    newAgentSteps[newAgentSteps.length - 1].step;
                }

                return [...prevSteps, promptStep, ...newAgentSteps];
              });
          // Reset to demo prompt for next run
          setInputs({ prompt: DEMO_PROMPT });
        } catch (parseError) {
          console.error('JSON parse error:', parseError);
          setParsedOutput({
            text: result || "Parse error occurred",
            steps: [],
            toolCalls: [],
            usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
            error: true,
            message: result || "Parse error occurred"
          });
        }
      } else {
        setOutput(result || "Unknown error");
        toast.error(result || "Unknown error");
        setParsedOutput({
          text: result || "Unknown error",
          steps: [],
          toolCalls: [],
          usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
          error: true,
          message: result || "Unknown error"
        } as AgentResult);
      }

      setInputHistory((prev) => ({
        ...prev,
        [selectedAgent]: [JSON.stringify({ prompt }), ...(prev[selectedAgent] || [])],
      }));
    } catch (err) {
      console.error('Error in runWithPrompt:', err);
      const errorMessage = err instanceof Error ? err.message : String(err) || 'Unknown error occurred';
      
      // Only show toast for actual errors, not for expected daily limit responses
      if (!errorMessage.includes('Daily run limit') && !errorMessage.includes('undefined')) {
        toast.error(`${errorMessage}`);
      }
      
      setParsedOutput({
        text: errorMessage,
        steps: [],
        toolCalls: [],
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        error: true,
        message: errorMessage
        } as AgentResult);
    } finally {
      setLoading(false);
    }
  };

  const handleInputSubmit = async () => {
    if (!selectedAgentDetails) return;
    const prompt = inputs.prompt || DEMO_PROMPT;
    await runWithPrompt(prompt);
  };

  const handleMobileReOpenOutputDrawer = () => {
    if (!outputDrawerOpen && parsedOutput) {
      setOutputDrawerOpen(true);
    }
  };

  return (
    <div className="flex flex-col h-screen overflow-x-hidden">
      <AgentHeader />
      <div className="flex-1 flex flex-col min-h-0 pb-4 bg-muted overflow-hidden relative">
        <div className="flex-1 flex flex-col md:flex-row min-h-0 w-full py-2">
          {selectedAgentDetails && (
            <InputPanel
              inputs={inputs}
              resetState={resetState}
              onInputChange={handleInputChange}
              selectedAgent={selectedAgentDetails}
              onExampleSelect={handleExampleSelect}
              selectedExampleIndex={selectedExampleIndex ?? -1}
              examplePrompts={examplePrompts[selectedAgent as keyof typeof examplePrompts] || []}
              hasPromptsRemaining={true}
              steps={timeline}
            >
              <ActionButtons
                inputs={inputs}
                loading={loading}
                isMobile={isMobile}
                resetState={resetState}
                inputHistory={currentAgentHistory}
                handleInputSubmit={handleInputSubmit}
                handleHistorySelect={handleHistorySelect}
                mobileReOpenOutputDrawer={handleMobileReOpenOutputDrawer}
                hasRunOnce={hasRunOnce}
                redisConnected={redisConnected}
                redisError={redisError}
              />
            </InputPanel>
          )}

          {isMobile ? (
            <MobileOutputPanel
              selectedAgent={selectedAgentDetails!}
              loading={loading}
              outputDrawerOpen={outputDrawerOpen}
              setOutputDrawerOpen={setOutputDrawerOpen}
            >
              <OutputPanel
                selectedAgent={selectedAgentDetails!}
                loading={loading}
                output={output}
                parsedOutput={parsedOutput}
              />
            </MobileOutputPanel>
          ) : (
            <div className="w-full md:w-1/2 flex flex-col">
            <OutputPanel
              selectedAgent={selectedAgentDetails!}
              loading={loading}
              output={output}
              parsedOutput={parsedOutput}
            />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
