'use strict';
const { gatewayPool } = require('../lib/gateway-ws.cjs');

/**
 * Get the gateway connection for the user making this request.
 * Throws 401-marked error if req.user.userId is missing.
 *
 * @param {object} req - Express request
 * @returns {GatewayConnection}
 */
function gatewayForReq(req) {
  const userId = req?.user?.userId;
  if (userId == null) {
    const err = new Error('gatewayForReq: req.user.userId required (auth middleware missing?)');
    err.status = 401;
    throw err;
  }
  return gatewayPool.forUser(userId);
}

module.exports = { gatewayForReq };
