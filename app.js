require('dotenv').config();
const express = require('express');
const { client } = require('./services');
const setupRoutes = require('./routes');

const app = express();
const PORT = process.env.PORT || 3000;

/* ---------- Middleware ---------- */
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

/* ---------- Routes ---------- */
setupRoutes(app, client);

/* ---------- Start Server ---------- */
app.listen(PORT, () => console.log(`🚀 Universal + Keyword-to-Book generator on port ${PORT}`));
