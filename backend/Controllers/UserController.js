const User = require('../Models/UserModel');
const bcrypt = require('bcrypt');
const SALT = parseInt(process.env.SALT, 10) || 10;
const {generateToken} = require('../Utils/GenerateToken');


exports.registerUser = async (req, res) => {
    // Logic to register a user
    const { name, email, password, role } = req.body;
    const user= await User.findOne({email});
    if(user){
        return res.status(400).json({message : 'User already exists'});
    }
    const hashedPassword = await bcrypt.hash(password, SALT);
    try{
        let date = new Date();
        const newUser = new User({ name, email, password : hashedPassword, role, createdAt : date});
        await newUser.save();
        newUser.password = null;
        res.status(201).json({message : 'User registered successfully', user : newUser});
    } catch (error) {
        res.status(500).json({message : 'Error registering user', error});
    }

};

exports.LoginUser = async(req, res) => {
    try{
        // Logic to login a user
        const { email, password} = req.body;
        const user = await User.findOne({email});
        if(!user){
            return res.status(400).json({message : 'User not found'});
        }
        console.log(user);
        
        const isMatch = await bcrypt.compare(password, user.password);
        console.log(isMatch);
        if(!isMatch){
            return res.status(400).json({message : 'Invalid credentials'});
        }

        const token = generateToken(user);
        console.log(token);
        if(token){
            res.status(200).json({_id : user._id,
                name : user.name,
                email : user.email,
                role : user.role,
                token : token});
        }
        else{
            res.sendStatus(500).json({message : 'Error generating token'});
        }

    }catch (error) {
        console.error('Error logging in user:', error);
        res.status(500).json({message : 'Error logging in user', error});
    }
};

exports.UpdateUser = async(req, res) => {
    // Logic to update a user
    try{
        const user = await User.findOne({_id : req.params.id});
        if(req.body.name!=null){
            user.name = req.body.name;
        }
        if(req.body.email!=null){
            user.email = req.body.email;
        }if(req.body.role!=null){
            user.role = req.body.role;
        }

        console.log(user);


        const updatedUser = await User.updateOne({_id : req.params.id}, user);
        if(!updatedUser){
            return res.status(404).json({message : 'User not found'});
        }

        res.status(200).json({message : 'User updated successfully', user : updatedUser});
    }
    catch (error) {
        console.error('Error updating user:', error);
        res.status(500).json({message : 'Error updating user', error});
    }
};  

exports.ChangePassword = async(req, res) => {
    try{
        const {newPassword, oldPassword, conOldPassword} = req.body;
        if(oldPassword != conOldPassword){
            return res.status(400).json({message : 'old password and confirm old password do not match'});
        }
        if(newPassword == oldPassword){
            return res.status(400).json({message : 'new password cannot be same as old password'});
        }
        const user = await User.findById(req.params.id);
        if(!user){
            return res.status(404).json({message: "user not found"});
        }

        const isMatch = await bcrypt.compare(oldPassword, user.password);
        if(!isMatch){
            return res.status(400).json({message : 'Invalid current password'});
        }

        const hashedPassword = await bcrypt.hash(newPassword, SALT);
        user.password = hashedPassword;
        await user.save();
        res.status(200).json({message : 'Password changed successfully'});
    }catch (error) {
        console.error('Error changing password:', error);
        res.status(500).json({message : 'Error changing password', error});
    }   
};

