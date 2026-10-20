const mongoose = require('mongoose');

const billSchema = new mongoose.Schema({
    date : {type :Date , required : true},
    products : {type : [
        {
            productId : {type : mongoose.Schema.Types.ObjectId, ref : 'Product', required : true},
            productName : {type : String, required : true},
            quantity : {type : Number, required : true},
            price : {type : Number, required : true}
        }
    ], required : true},
    totalAmount : {type : Number, required : true},
    tag : {type : String, enum : ['Paid', 'Unpaid']},
    customerName : {type : String}
});

module.exports = mongoose.model('Bill', billSchema);