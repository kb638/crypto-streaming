Project Pluto — Crypto Price Streaming
A full-stack web application that streams live cryptocurrency prices from TradingView using Playwright, with a Node.js backend and Next.js frontend.
Built as part of the Project Pluto coding assessment.
Tech Stack
- TypeScript
- Node.js
- Next.js
- pnpm (package manager)
- ConnectRPC for backend/frontend communication
- Playwright for browser automation and price scraping
Features
- Add and remove cryptocurrency tickers (e.g., BTCUSD, ETHUSD, SOLUSD)
- Real-time price updates streamed directly from TradingView
- Playwright runs in headed mode so browser actions are visible
- Alphabetically sorted ticker list in the UI
- Graceful handling of ticker removal and backend cleanup
- Exposes health check (/health) and metrics (/metrics) endpoints
Requirements
- Node.js >= 18
- pnpm >= 8
- bash (for run.sh)
Installation & Run
Clone the repository and run:

bash run.sh

The script will:
1. Install all dependencies (pnpm install --recursive)
2. Generate protobuf code (buf generate)
3. Start both backend and frontend (pnpm dev)
Access
- Frontend (Next.js): http://localhost:3000
- Backend (ConnectRPC): http://localhost:8080
Development Notes
- Prices are streamed from URLs of the format:
  https://www.tradingview.com/symbols/{ticker}/?exchange=BINANCE
- Playwright sessions are capped (configurable in config.ts) to avoid resource overload
- Ticker streams are throttled slightly to avoid flooding the UI
- Closing a ticker releases backend resources after a short grace window
Health & Metrics
- GET /health → returns service health
- GET /metrics → returns current Playwright session stats
Submission
- All dependencies are listed in package.json
- pnpm install --recursive installs everything needed
- ./run.sh launches the full application
