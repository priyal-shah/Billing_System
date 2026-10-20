const Business = require('../Models/Business');

exports.AddBusiness = async (req, res)=> {
    try{    
        // Logic to add a business
        const business = new Business();
        if(req.body.name) business.name = req.body.name;
        else{
            return res.status(400).json({message : "Business name is required"});
        }
        if(req.body.description) business.description = req.body.description || "";
        if(req.body.address) business.address = req.body.address || "";
        if(req.body.contact) business.contact = req.body.contact || "";
        if(req.body.email) business.email = req.body.email || "";
        if(req.body.gstinNo) business.gstinNo = req.body.gstinNo;
        else{
            return res.status(400).json({message : "GSTIN number is required"});
        }
        await business.save();
        res.status(201).json({ message: "Business added successfully", business });
    }catch(error){
        console.error('Error adding business:', error);
        res.status(500).json({ message: error.message });
    }
};

exports.updateBusiness = async (req, res) => {
    try{
        // Logic to update a business
        const business = await Business.findById(req.params.id);
        if(!business){
            return res.status(404).json({message : "Business not found"});
        }
        // Update business properties
        if(req.body.name) business.name = req.body.name;
        if(req.body.description) business.description = req.body.description;
        if(req.body.address) business.address = req.body.address;
        if(req.body.contact) business.contact = req.body.contact;
        if(req.body.email) business.email = req.body.email;
        if(req.body.gstinNo) business.gstinNo = req.body.gstinNo;

        await business.save();
        res.status(200).json({ message: "Business updated successfully", business });
    }catch(error){
        console.log("Error updating the business details", error);
        return res.status(500).json({message : "Error updating the buusiness details", error});
    }
};

exports.deleteBusiness = async (req, res) => {
    try{
        await Business.deleteOne({_id : req.params.id});
        res.status(200).json({message : "Business deleted successfully"});
    }catch(error){
        console.log("Error deleting the business details", error);
        return res.status(500).json({message : "Error deleting the business details", error});
    }
}

exports.getBusinessDetails = async (req, res) =>{
    try{
        const re = new RegExp(req.query.keyword, 'i');
        const business = await Business.findOne({name  : re});
        if(!business){
            return res.status(404).json({message : "Business not found"});
        }
        res.status(200).json({ message: "Business details retrieved successfully", business });
    }catch(error){
        console.log("Error fetching business details", error);
        return res.status(500).json({message : "Error fetching business details", error});
    }
}

exports.getBusinessDetailsById = async (req, res) =>{
    try{
        const business = await Business.findById(req.params.id);
        if(!business){
            return res.status(404).json({message : "Business not found"});
        }
        res.status(200).json({ message: "Business details retrieved successfully", business });
    }catch(error){
        console.log("Error fetching business details", error);
        return res.status(500).json({message : "Error fetching business details", error});
    }
};