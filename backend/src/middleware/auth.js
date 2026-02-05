const jwt = require('jsonwebtoken');

function auth(req, res, next) {
  console.log("Auth middleware invoked");
  const header =req.headers.authorization;

  if (!header) {
    return res.status(401).json({ error: 'No token provided' });
  }

  const token = header.split(' ')[1];

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

module.exports = auth;
