const express = require('express');
const route= express.Router();

const {registerUser, LoginUser, UpdateUser, ChangePassword} = require('../Controllers/UserController');

route.post('/register', registerUser);

route.post('/login', LoginUser);

route.put('/update/:id', UpdateUser);

route.put('/updatePassword/:id', ChangePassword);

// route.delete('/delete/:id', DeleteUser);

module.exports =route;
