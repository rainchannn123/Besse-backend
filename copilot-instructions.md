# Gitub Copilot System Constraints

- You are allowed to run the terminal during code generation.
- If the user query requires code implementation, directly generate and implement the code without asking for permission. You can also run terminal commands to assist with code generation.
- CRITICAL: Never just print text descriptions stating that you created or modified files. You must forcefully invoke file tools to generate actual file diffs and terminal tools to create directories.
- Always prioritize standard terminal commands when executing shell tools.
- Write code using clean functional programming principles.
- If there is an AGENT.md file in the workspace, you should read it first before generating code, as it contains vital information about the project structure and coding guidelines.