# Vedanshi Mesvaniya | Portfolio

Personal portfolio for an AI Engineer. Plain HTML, CSS and JavaScript. No framework, no build step, no server code, so GitHub Pages can host it straight from this repository.

**Live site:** https://vedanshimesvaniya.github.io/Portfolio/

## What's on the page

- About, Experience, Projects, Skills, Education, Certifications, Contact
- **Ask this portfolio**: a chat that answers questions about Vedanshi. It works on its own with built-in answers, and gets free-form answers from Groq (gpt-oss-20b) once the worker in `/worker` is deployed
- Fit check: if a visitor describes a project, the chat says whether it matches the resume (good, partial or no match) and gives contact details
- Drop PDFs about yourself into `/knowledge` and the chat answers from them
- Light theme by default with a dark switch, neuron background, typing effect on the name (both respect reduced-motion settings)

## Host it on GitHub Pages

1. Open the repository on GitHub, then **Settings > Pages**.
2. Under **Build and deployment**, set **Source** to **Deploy from a branch**.
3. Choose branch **main** and folder **/ (root)**, then **Save**.
4. After a minute the site is live at `https://<username>.github.io/<repository>/`.

## Run it locally

```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

Opening `index.html` directly in a browser also works.

## Edit the content

| What | Where |
| --- | --- |
| Text, projects, skills, links | `index.html` |
| Colours, fonts, spacing | the tokens at the top of `assets/css/style.css` |
| Page behaviour | `assets/js/main.js` |
| Chat answers | `assets/js/ask.js` |
| CV | replace `assets/docs/Vedanshi_Mesvaniya_Resume.pdf` (keep the file name) |
| Favicon and social image | `assets/img/` |

The chat reads the page, so when you change a job, project, skill, degree or contact detail in `index.html` the answers change too. Each project and job also has a `data-brief` (one plain sentence the chat uses) and a `data-alias` (other names people might type). Update those when you edit the item.

To add a project, copy an existing `<article class="proj ...">` block and change the text.

## The chat, the worker and your documents

- `assets/js/config.js` holds the worker address (`askEndpoint`). Empty means built-in answers only.
- `worker/` is the Cloudflare Worker that calls Groq. Setup, deploy and security notes are in `worker/README.md`.
- `knowledge/` is where you drop PDFs. After adding files run `npm run build:knowledge` (or `npm run deploy`) inside `worker/`, then commit.
- Never commit API keys. They go in Cloudflare secrets or the git-ignored `worker/.dev.vars`.

## Credits

- Fonts: [Space Grotesk](https://github.com/floriankarsten/space-grotesk) and [Plus Jakarta Sans](https://github.com/tokotype/PlusJakartaSans), both under the SIL Open Font License, self-hosted via Fontsource.
- GitHub icon from [Simple Icons](https://simpleicons.org) (CC0).
