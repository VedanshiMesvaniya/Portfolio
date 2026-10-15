# Ask worker (Groq, gpt-oss-20b)

A small Cloudflare Worker that answers visitor questions in the "Ask this portfolio" chat. It sends the question plus the few most relevant passages from your documents (`/knowledge`) to Groq's `openai/gpt-oss-20b` model and returns a short answer. The site works without it, using its built-in answers; this adds free-form answers and PDF knowledge.

```
visitor question -> worker -> pick best passages from your PDFs -> Groq gpt-oss-20b -> short answer
                      \-> anything not covered: answer + your contact details
                      \-> someone describes a project: honest "Good fit / Partial fit / Not a match"
```

## 1. Set up (once)

```bash
cd worker
npm install
```

Create a Groq API key at https://console.groq.com (API Keys). No card needed on the free plan.

## 2. Try it on your computer

```bash
cp .dev.vars.example .dev.vars      # then open .dev.vars and paste your key
npm run dev                         # builds the knowledge and starts the worker on http://localhost:8787
```

In another terminal:

```bash
curl -s http://localhost:8787 \
  -H "Origin: http://localhost:8000" -H "Content-Type: application/json" \
  -d '{"question":"Does Vedanshi know Qdrant?"}'
```

You should get `{"answer":"...","contact":false}`. To try it inside the site, run `python3 -m http.server 8000` in the repo root and temporarily set `askEndpoint: 'http://localhost:8787'` in `assets/js/config.js`.

## 3. Put it online

```bash
npx wrangler login                          # opens the browser, free Cloudflare account
npx wrangler secret put GROQ_API_KEY        # paste the key when asked (it is stored by Cloudflare, not in git)
npm run deploy                              # prints https://portfolio-ask.<your-name>.workers.dev
```

Paste that URL into `assets/js/config.js`:

```js
window.PORTFOLIO_CONFIG = { askEndpoint: 'https://portfolio-ask.<your-name>.workers.dev' };
```

Commit and push. Check the live worker once:

```bash
curl -s https://portfolio-ask.<your-name>.workers.dev \
  -H "Origin: https://vedanshimesvaniya.github.io" -H "Content-Type: application/json" \
  -d '{"question":"What did Vedanshi build at Param Software?"}'
```

## Adding documents

Put PDFs (or `.txt` / `.md`) in `/knowledge` and run `npm run deploy` again. Anything in `/knowledge` is public in the repo. Files in `/knowledge/private` are never committed: only the deployed worker uses them. Details are in `knowledge/_README.md`.

## What it will and won't do

- Answers only from your documents and the short profile in `src/profile.js`. If something isn't covered it says so and adds your email, phone and LinkedIn.
- Project requests get an honest fit verdict with evidence from your projects, and a reminder that scope, availability and rates must be agreed directly.
- Rules and tone live in `src/profile.js`. Change them there.

## Limits and cost

On Groq's free plan, `openai/gpt-oss-20b` allows 30 requests and 8,000 tokens per minute, and 1,000 requests and 200,000 tokens per day (check https://console.groq.com/docs/rate-limits for current numbers). One question here uses roughly 1.5k to 2.5k tokens, so expect about 3 questions a minute and around 80 to 100 a day on the free plan. When Groq says "busy" the site quietly falls back to its built-in answers. A paid Groq plan raises all of these.

## Security

- The Groq key lives only in Cloudflare (`wrangler secret`) and in your local, git-ignored `.dev.vars`. Never put it in `config.js` or any file in the site.
- Only the origins in `ALLOWED_ORIGINS` (`wrangler.toml`) can call the worker. Add your custom domain there if you get one.
- There is a small per-visitor limit inside the worker. For a hard limit, add a rate-limiting rule in the Cloudflare dashboard.
- Visitors' questions pass through Cloudflare and Groq. Don't put anything in `/knowledge` that you would not say to a visitor.
- If a key ever leaks, delete it in the Groq console and run `npx wrangler secret put GROQ_API_KEY` with a new one.

## Troubleshooting

| Symptom | Cause |
| --- | --- |
| 403 `Origin not allowed` | the page's address isn't in `ALLOWED_ORIGINS` |
| 500 `missing GROQ_API_KEY` | run `npx wrangler secret put GROQ_API_KEY` |
| 502 `Model error` | wrong model id in `wrangler.toml`, or the key is invalid |
| 503 `busy` | Groq rate limit; wait a minute |
| chat shows built-in answers only | `askEndpoint` is empty or the worker returned an error |

Run the tests with `npm test`.
