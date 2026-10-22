const jwt = require('jsonwebtoken');

const ISSUER = 'resilience-auth';
const ACCESS_AUDIENCE = 'resilience-api';

const signAccessToken = (user, amr) =>
  jwt.sign(
    {
      sub: String(user.id),
      role: user.role,
      amr
    },
    process.env.JWT_SECRET,
    {
      expiresIn: '1h',
      algorithm: 'HS256',
      issuer: ISSUER,
      audience: ACCESS_AUDIENCE
    }
  );

const verifyAccessToken = (token) =>
  jwt.verify(token, process.env.JWT_SECRET, {
    algorithms: ['HS256'],
    issuer: ISSUER,
    audience: ACCESS_AUDIENCE
  });

module.exports = { signAccessToken, verifyAccessToken };
