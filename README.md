# FastLang server (with login + database)

Run locally (saves users to data/users.json, no install needed):
    node server.js        then open http://localhost:3000

Use MongoDB (recommended for hosting):
1. Create a free cluster at mongodb.com/atlas, add a database user, and under
   Network Access allow your IP (or 0.0.0.0/0 for a hosted site).
2. Copy the connection string (mongodb+srv://user:password@cluster.../).
3. npm install
4. Set the environment variable MONGODB_URI to that string, then npm start.
   Windows (PowerShell):  $env:MONGODB_URI="..." ; npm start
   Mac/Linux:             MONGODB_URI="..." npm start
   On Render/Railway: add MONGODB_URI under Environment, build "npm install", start "npm start".
The server prints "Users stored in: MongoDB" when it is connected.
Users go in database "fastlang" (change with MONGODB_DB), collection "users".

Pages: /login.html /register.html /account.html (logged-in only)
API:   POST /api/register, /api/login, /api/logout   GET /api/me
Sessions are in memory, so everyone is logged out when the server restarts.
Never commit your MONGODB_URI to GitHub.
