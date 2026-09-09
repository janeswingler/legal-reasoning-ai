# legal-reasoning-ai
Research prototype for a University of San Francisco study. Law students use an AI chatbot to complete weekly legal reasoning assignments.

## Tech stack
- **Backend:** Node.js, Express.js
- **Database:** MariaDB / MySQL (raw SQL via `mysql2`; schema in `server/sql/`)
- **Frontend:** HTML, CSS, JavaScript
- **AI:** Anthropic Claude API
- **Deployment:** TBD

## Project structure
The app is organised UI-first under `public/`, with backend code under `server/`

```text
legal-reasoning-ai/
├── public/
│   ├── css/
│   ├── js/
│   └── assets/
├── server/
│   ├── config/
│   ├── db/
│   ├── routes/
│   ├── services/
│   └── middleware/
├── server.js
└── package.json
```

## Getting started