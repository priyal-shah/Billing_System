require('dotenv').config({ path: './Secrets.env' });
const app = require('./App');
const connectDB = require('./config/db');

server = async()=>{
    // Connect to MongoDB
    await connectDB();

    const PORT = process.env.PORT || 5000;

    app.listen(PORT, ()=>{
        console.log(`Server is listening at the port ${PORT}`);
    });
}

server();



