const route = require('express').Router();
const { addBusiness, updateBusiness, deleteBusiness, getBusinessByKeyword } = require('../Controllers/BusinessController');

route.post('/add', addBusiness);
route.put('/update/:id', updateBusiness);
route.delete('/delete/:id', deleteBusiness);
route.get('/search', getBusinessByKeyword);
route.get('/search/:id', getBusinessByKeyword);

module.exports = route;