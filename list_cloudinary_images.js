/*
 * Copyright 2016-present, Simon Whitaker
 * All rights reserved.
 *
 * This source code is licensed under the license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */

/* jshint node: true, devel: true */
'use strict'

const cloudinary = require('cloudinary')

cloudinary.api.resources(function (result, error) {
  if (error) {
    console.log('Error: ' + error)
  } else {
    for (var resource of result.resources) {
      console.log(JSON.stringify(resource, null, 2))
    }
  }
})
