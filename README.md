# Skyfire x [Buildship](https://buildship.tools) Company and Competitor Research Agent


This is an agent capable of conducting company and competitor research. It demonstrates the capability of programatically paying buildship to use its tools in order to complete a research report on a company (in this demo that company being Visa).

## Prerequisites

- Node.js (LTS version recommended - specific version not defined in project files)
- Yarn (v1 based on `yarn.lock`)

## Installation

1.  Clone the repository:
    ```bash
    git clone <repository-url>
    cd skyfire-solutions-buildship-demo
    ```
2.  Install dependencies:
    ```bash
    yarn install
    ```
3.  Set up environment variables:
    Create a `.env.local` file in the root directory. You can copy `.env.example` if one exists, or add the necessary variables manually. Consult the team or configuration files for required variables. At minimum, you will likely need:

    ```
    # .env.local

    # Required by AI SDK for the agent model
    OPENAI_API_KEY=your_openai_api_key

    # Required by AI SDK for the agent model
    SKYFIRE_MCP_URL=https://mcp.skyfire.xyz/mcp

    # Optional - Can be set via UI, but useful as a fallback/default
    # SKYFIRE_API_KEY=your_skyfire_api_key

    # Set test mode to true so doesn't rate limit runs with Redis
    # TEST_MODE=true
    ```

DAILY_RUN_CAP, RENDER, NODE_ENV, REDIS_URL_PROD, REDIS_URL_LOCAL are all optional env variables that can be used when you deploy this agent to a cloud. We use these variables to cap the amount of live demo runs because we are funding these buyer agents with actual money.

## Getting Started

Run the development server:

```bash
yarn dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `src/app/page.tsx`. The page auto-updates as you edit the file.

Modify the demo prompt to run the demo for companies other than Visa or use other Buildship tools in src/lib/types.ts

## Available Scripts

- `yarn dev`: Starts the development server on `localhost:3000`.
- `yarn build`: Creates an optimized production build of the application.
- `yarn start`: Starts the production server (requires a build first).
- `yarn lint`: Runs ESLint to check for code quality and potential errors.
- `yarn codebase`: (Requires `code2prompt` CLI tool) Generates a prompt suitable for AI models, containing the project's codebase.

_Note:_ No specific test script (`yarn test`) is defined in `package.json` for this version.

## Project Structure

- `public/`: Static assets (SVGs, favicon) served directly.
- `src/`: Contains the main application source code.
  - `app/`: Next.js App Router pages, layout, actions, and global styles (`globals.css`).
  - `components/`: Reusable React components.
    - `ui/`: UI components built with shadcn/ui.
    - `agent/`: Components specific to the agent interaction UI.
    - Other shared components (`data-view.tsx`, `markdown-renderer.tsx`, etc.).
  - `context/`: React Context providers (e.g., `app-provider.tsx` for API key management).
  - `hooks/`: Custom React hooks (e.g., `use-media-query.tsx`).
  - `lib/`: Utility functions (`utils.ts`), type definitions (`types.ts`), constants (`data.ts`), rate limiting logic (`rate-limit.ts`), animation definitions (`animations.ts`), and agent-related logic/placeholders (`agent/`).
- `package.json`: Project dependencies and scripts.
- Configuration files:
  - `next.config.ts`: Next.js configuration.
  - `postcss.config.mjs`: PostCSS configuration (includes Tailwind).
  - `tailwind.config.js` (Implied via PostCSS config): Tailwind CSS configuration.
  - `tsconfig.json`: TypeScript configuration.
  - `eslint.config.mjs`: ESLint flat configuration.
  - `components.json`: shadcn/ui configuration.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load the [Geist](https://vercel.com/font) font family.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
