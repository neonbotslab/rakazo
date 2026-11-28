export const procStartResult = JSON.stringify(
  {
    id: "warden.proc_start",
    name: "proc_start",
    description:
      "Start a background process and return its process ID. The command keeps running after this request returns. Use the process ID to read recent output, check whether the command is still running, or stop it.",
    inputSchema: {
      type: "object",
      properties: {
        agent: { type: "string", description: "Agent that runs the command." },
        command: { type: "string", description: "Command to start." },
        workdir: { type: "string", description: "Working directory for the command." },
        env: { type: "object", description: "Environment variables for the process." },
      },
      required: ["agent", "command"],
      additionalProperties: false,
    },
  },
  null,
  2,
);
