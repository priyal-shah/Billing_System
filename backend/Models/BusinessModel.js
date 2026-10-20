const mongoose = require('mongoose');

const businessSchema= new mongoose.Schema({
    name :{type : String , required : true},
    description : {type : String},
    address : {type : String},
    contact : {type : String},
    email : {type : String},
    gstinNo : {type : String, required : true, unique : true},
    createdAt : {type : Date, default : Date.now}
});

module.export = mongoose.model('Business', businessSchema);