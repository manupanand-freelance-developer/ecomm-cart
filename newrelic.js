'use strict'

/**
 * New Relic agent configuration.
 */
exports.config = {
  app_name: ['cart-service'], // Give your service a name
  license_key: 'YOUR_NEW_RELIC_LICENSE_KEY',
  logging: {
    level: 'info'
  }
}
