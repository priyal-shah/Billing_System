const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET

exports.generateToken = (user) => {
    try{
        console.log(JWT_SECRET);
        const token = jwt.sign({ id: user._id}, JWT_SECRET, { expiresIn: '1h' });
        return token;

    } catch (error) {
        console.error('Error generating token:', error);
        throw new Error('Error generating token');
        return null;
    }
}