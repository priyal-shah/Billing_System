const route = require('express').Router();

const {addProduct, updateProduct, deleteProduct, getProductById, getAllProduct, getProductByCategory, getProductByTag, getProductByName, getProductByKeyword} = require('../Controllers/ProductController');

route.post('/add', addProduct);

route.put('/update/:id', updateProduct);    

route.delete('/delete/:id', deleteProduct);

route.get('/search', getProductByKeyword);

route.get('/getAll', getAllProduct);

route.get('/getByCategory', getProductByCategory);

route.get('/getByTag', getProductByTag);    

route.get('/getByName', getProductByName);

route.get('/getById/:id', getProductById);

module.exports = route;