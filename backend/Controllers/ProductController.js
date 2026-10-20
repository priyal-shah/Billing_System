const Product = require('../Models/ProductModel');

exports.addProduct = async(req, res)=>{
    try{
        // Logic to add a product
        const product = new Product(req.body);
        const savedProduct = await Product.findOne({ name: product.name });
        if (savedProduct) {
            return res.status(400).json({ message: 'Product already exists' });
        }
        await product.save();
        res.status(201).json(product);
    }catch(error){
        res.status(500).json({ message: error.message });
    }

};

exports.updateProduct = async(req, res)=>{
    try{
        // Logic to update a product
            const product = await Product.findById(req.params.id);        
            if(!product){
                return res.status(404).json({message : 'Product not found'});
            }
            
            product.name = req.body.name || product.name;
            product.price = req.body.price || product.price;
            product.description = req.body.description || product.description;
            product.quantity = req.body.quantity || product.quantity;
            product.tag = req.body.tag || product.tag;
            product.category = req.body.category || product.category;
            product.createdAt = Date.now();

            const savedProduct = await product.save();
            res.status(200).json(savedProduct);

    }catch(error){
        console.error('Error updating product:', error);
        res.status(500).json({ message: error.message });
    }
};

exports.deleteProduct = async(req, res)=>{
    try{
        // Logic to delete a product
        const product = await Product.findById(req.params.id);
        if(!product){
            return res.status(404).json({message : 'Product not found'});
        }
        const result = await Product.deleteOne({_id : req.params.id});
        res.sendStatus(204).json({message : 'Product deleted successfully'});
    }catch(error){
        console.error('Error deleting product:', error);
        res.status(500).json({ message: error.message });
    }
};

exports.getProductByKeyword = async(req, res)=>{
    try{
        // Logic to get a product
        console.log("starting...");
        const keyword= req.query.keyword;
        console.log(keyword);
        if(!keyword || !String(keyword).trim()){
            return res.status(400).json({ message: 'keyword query parameter is required' });
        }

        const escaped = String(keyword).replace(/[.*+?^${}()|[\\]\\]/g, '\\$&');
        const re = new RegExp(escaped, 'i');

        const products = await Product.find({
            $or: [
                { name: re },
                { description: re },
                { tag: re },
                { category: re }
            ]
        });

        console.log(products);
        if(!products || products.length === 0){
            return res.status(404).json({ message: 'No products found' });
        }

        return res.status(200).json(products);
    }
    catch(error){
        console.error('Error getting product:', error);
        res.status(500).json({ message: error.message });
    }
};

exports.getProductByName = async(req, res)=>{
    try{
        // Logic to get a product by name
        const keyword= req.query.keyword;
         if(!keyword || !String(keyword).trim()){
            return res.status(400).json({ message: 'keyword query parameter is required' });
        }

        //const escaped = String(keyword).replace(/[.*+?^${}()|[\\]\\]/g, '\\$&');
        const re = new RegExp(keyword, 'i');

        const products= await Product.find({name: re}); 
        console.log(products);
        if(!products || products.length === 0){
            res.sendStatus(404).json({message : 'No products found'});
        }   
        res.status(200).json(products);
    }catch(error){
        console.error('Error getting product by name:', error);
        res.status(500).json({ message: error.message });
    }
};

exports.getProductByTag = async(req, res)=>{
    try{
        // Logic to get a product by tag
        const keyword= req.query.keyword;
        const re = new RegExp(keyword, 'i');
        const products= await Product.find({tag: re}); 
        if(!products || products.length === 0){
            res.sendStatus(404).json({message : 'No products found'});
        }   
        res.status(200).json(products);
    }catch(error){
        console.error('Error getting product by name:', error);
        res.status(500).json({ message: error.message });
    }
};

exports.getProductByCategory = async(req, res)=>{
    try{
        // Logic to get a product by category
        const keyword= req.query.keyword;
        const re = new RegExp(keyword, 'i');
        const products= await Product.find({category: re}); 
        if(!products || products.length === 0){
            res.sendStatus(404).json({message : 'No products found'});
        }   
        res.status(200).json(products);
    }catch(error){
        console.error('Error getting product by name:', error);
        res.status(500).json({ message: error.message });
    }
};

exports.getAllProduct = async(req, res)=>{
    try{
        // Logic to get all product
        
        const products= await Product.find();

        if(!products){
            res.sendStatus(404).json({message : 'No products found'});
        }   

        res.status(200).json(products);
    }catch(error){
        console.error('Error getting product by name:', error);
        res.status(500).json({ message: error.message });
    }
};

exports.getProductById = async(req, res)=>{
    try{
        // Logic to get a product by id
        const product = await Product.findById(req.params.id);
        if(!product){
            res.sendStatus(404).json({message : 'No product found'});
        }   
        res.status(200).json(product);

    }catch(error){
        console.error('Error getting product by id:', error);   
        res.status(500).json({ message: error.message });
    }
};