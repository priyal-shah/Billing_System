const Bill = require('../Models/Bill');

exports.addBill = async(req, res) => {
    try{
        // Logic to add a bill
        const bill = new Bill(req.body);
        await bill.save();
        res.status(201).json(bill);

    }catch(error){
        console.error("Error adding the Bill : ", error);
        res.status(500).json({message : "Error adding the Bill",  error});
    }
};

exports.getBillById = async(req, res) => {
    try{
        // Logic to get a bill by id    
        const bill = await Bill.getBillById(req.params.id);
        if(!bill) return res.status(400).json("No bill found");

        res.status(200).json(bill);

    }catch(error){
        console.error("Error searching the Bill", error);
        res.status(500).json({message : "Error searching the bill : ", error});
    }
};