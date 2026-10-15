# Knowledge folder

Drop PDFs (and .txt / .md files) about Vedanshi here: resume, certificates, project write-ups,
case studies, a longer bio. The "Ask this portfolio" chat answers from them.

- `knowledge/` is public. Anything here is visible in the repository and on the site.
- `knowledge/private/` is ignored by git. Files there are only read by your own machine when you
  deploy the worker, so the chat can use them without publishing them. The chat can still repeat
  what is in them, so only put things you are happy for visitors to hear.
- Files that start with `_` (like this one) are ignored.
- PDFs must contain real text. Scanned images need OCR first.

After adding or changing files, run this inside `worker/`:

    npm run build:knowledge      # refreshes the generated files
    npm run deploy               # rebuilds and publishes the worker

then commit the changed files (the generated ones are in `worker/src/` and `assets/data/`) and push.
