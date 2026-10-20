const express = require('express');
const app = express();

app.use(express.json());

app.use('/api/user', require('./Routes/User'));

app.use('/api/product', require('./Routes/Product'));

app.use('/api/business', require('./Routes/Business'));

module.exports = app;
