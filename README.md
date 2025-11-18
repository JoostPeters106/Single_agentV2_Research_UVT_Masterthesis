# Brightwave Sales Prioritization Lab

This project provides a minimal, production-ready web application for an academic experiment studying interaction styles for sales decision-support. The tool helps Brightwave Solutions sales employees decide which customers to contact first, powered by a validation gate and a single recommendation agent.

## Features

- **Validator Gate**: Confirms the user prompt is aligned with the case before any model call.
- **Agent Timeline**: Transparent cards that show the validation status and the recommender's response.
- **Two-Step Reactions**: A combined endpoint now delivers an initial suggestion and a reconsidered follow-up once the prompt is approved.
- **Dataset Visibility**: Toggleable 10×12 customer dataset used for reasoning.
- **Model Abstraction**: Central helper injects the required system context and calls the Google Generative Language API.
- **Fairness & Transparency**: Every response cites the exact fields used.

## Requirements

- Node.js 18+
- Google Generative Language API key (Gemini 2.5 Flash). The server defaults to the provided Brightwave experiment key if `GEMINI_API_KEY` is not supplied.

## Environment Setup

1. (Optional) Copy the example environment file and populate credentials if you prefer to override the baked-in defaults:

   ```bash
   cp .env.example .env
   # edit .env to include GEMINI_API_KEY if overriding the default key
   ```

2. Install dependencies:

   ```bash
   npm install
   ```

3. Start the server:

   ```bash
   npm start
   ```

4. Open the app at [http://localhost:3000](http://localhost:3000).

## Docker

1. Build the container image:

   ```bash
   docker build -t brightwave-app .
   ```

2. Run the container with environment variables (only required if you need to override the built-in defaults of `https://generativelanguage.googleapis.com` and `gemini-2.5-flash`):
   ```bash
   docker run --rm -p 3000:3000 \
     -e GEMINI_API_KEY=your_key_here \
     -e BASE_URL=https://generativelanguage.googleapis.com \
     -e MODEL=gemini-2.5-flash \
     brightwave-app
   ```

### Docker Compose

Alternatively, use docker-compose:

```bash
docker-compose up --build
```

The compose file expects a `.env` file in the project root for configuration.

## Project Structure

```
├── data/Customer_List_with_YTD_Purchases.csv
├── public/
│   ├── index.html
│   ├── style.css
│   └── app.js
├── server.js
├── package.json
├── .env.example
├── Dockerfile
├── docker-compose.yml
└── README.md
```

## API Endpoints

- `POST /api/validate` — semantic safety check for user prompts.
- `POST /api/agent1` — initial recommendation agent.
- `POST /api/system-flow` — runs validation then returns both reaction messages when the prompt matches the case.
- `GET /api/customers` — returns the dataset for the UI.
- `GET /api/health` — health check endpoint.

All model prompts include the mandated system context, enforce ≤80 word outputs, and cite referenced fields.

## Notes

- The application logs prompts and responses server-side for audit purposes (secrets are not logged).
- Requests are limited to 30 per minute with a 30-second timeout to keep the service responsive.
- The UI includes a “Copy Final Recommendation” button to support embedding in surveys.
