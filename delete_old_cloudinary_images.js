/*
 * Copyright 2016-present, Simon Whitaker
 * All rights reserved.
 *
 * This source code is licensed under the license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * To run:
 *
 *   heroku local:run node delete_old_cloudinary_images.js
 *
 * To run against a specific env:
 *
 *   heroku local:run --env .env.production node delete_old_cloudinary_images.js
 */

/* jshint node: true, devel: true */
'use strict'

const cloudinary = require('cloudinary')
const MAX_AGE_DAYS = 3
const USER_UPLOAD_TAG = 'user-upload'

function fetch_and_process (cursor) {
  cloudinary.v2.api.resources(
    {
      max_results: 50,
      next_cursor: cursor,
      tags: [USER_UPLOAD_TAG]
    },
    function (error, result) {
      if (error) {
        console.error(error.message)
      } else {
        var now = Date.now()
        var public_ids_to_delete = []

        for (var resource of result.resources) {
          var upload_date = new Date(resource.created_at)
          var age_ms = now - upload_date
          var age_days = age_ms / 1000 / 60 / 60 / 24

          if (age_days > MAX_AGE_DAYS) {
            console.info('Deleting %s (uploaded %d days ago)',
              resource.public_id,
              age_days.toFixed(1)
            )
            public_ids_to_delete.push(resource.public_id)
          }
        }

        if (public_ids_to_delete.length > 0) {
          cloudinary.v2.api.delete_resources(
            public_ids_to_delete,
            function (error, result) {
              if (error) {
                console.error('On deleting images: %s', error.message)
              }
            }
          )
        }
        if (result.next_cursor) {
          fetch_and_process(result.next_cursor)
        }
      }
    }
  )
}

fetch_and_process()
