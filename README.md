Project Pluto — Fullstack Engineer Coding Assessment
Overview
This project is a full-stack web application that streams real-time cryptocurrency prices from TradingView. It demonstrates backend scraping with Playwright, server-streaming with ConnectRPC, and a React/Next.js frontend for live updates.
Tech Stack
- TypeScript
- Next.js
- Node.js
- tsx for TypeScript execution
- pnpm for package management
- ConnectRPC for communication
- Playwright for scraping TradingView

Features
- Add/remove cryptocurrency tickers (e.g., BTCUSD, ETHUSD).
- Live streaming of prices directly from TradingView (BINANCE exchange).
- Prices update with minimal latency using server-streaming.
- Playwright runs in headed mode so browser automation is visible.
- UI shows live tickers sorted alphabetically with up/down flash indicators.
- Backend metrics and health endpoints.
- Graceful shutdown and per-ticker session management.

Requirements
- Node.js v20+
- pnpm v10+
- Playwright (installed via pnpm)
- bash (for run.sh)

Installation & Running
1. Clone the repository.
2. Run the following command to install dependencies recursively:
   
   pnpm install --recursive
   
3. To generate protobuf code:
   
   pnpm -w exec buf generate packages/api
   
4. To start the development servers:
   
   pnpm dev
   
   This runs both backend (http://localhost:8080) and frontend (http://localhost:3000).
   
5. Alternatively, use the provided run.sh script (Linux/macOS):
   
   bash run.sh
   
   This will install dependencies, generate protobufs, and start the app.
   
   On Windows, you can run the same steps manually or use Git Bash to execute run.sh.

Usage
- Open http://localhost:3000 in your browser.
- Enter a ticker (e.g., BTCUSD, ETHUSDT) and press Enter or click Add.
- The app opens a Playwright browser window (headed) and scrapes prices.
- Prices are streamed to the frontend with live updates.
- Remove a ticker by clicking the × button.

Notes
- For simplicity, the exchange is fixed to BINANCE.
- Playwright sessions are reused and managed with ref counts.
- Sessions are automatically closed when unused.
- The run.sh script is provided for Linux/macOS environments as expected by the evaluator.

