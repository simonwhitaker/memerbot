/*
 * Copyright 2016-present, Simon Whitaker
 * All rights reserved.
 *
 * This source code is licensed under the license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * To run:
 *
 *   heroku local:run node list_stock_images.js
 *
 * To run against a specific env:
 *
 *   heroku local:run --env .env.production node list_stock_images.js
 */

/* jshint node: true, devel: true */
'use strict'

const cloudinary = require('cloudinary')
const STOCK_PREFIX = 'stock/'

function main() {
  cloudinary.v2.api.resources(
    {
      type: 'upload',
      prefix: STOCK_PREFIX,
      max_results: 100
    },
    function (error, result) {
      if (error) {
        console.error(error.message)
      } else {
        var image_ids = []
        for (var resource of result.resources) {
          // do something with resource.public_id,
          var image_id = resource.public_id.substring(STOCK_PREFIX.length)
          image_ids.push(image_id)
        }
        image_ids.sort()
        var output = 'Choose from:\n'
        for (var image_id of image_ids) {
          output = output + '\n' + image_id
        }
        console.log(output)
      }
    }
  )
}

main()
