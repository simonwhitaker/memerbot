/*
 * Copyright 2016-present, Simon Whitaker
 * All rights reserved.
 *
 * This source code is licensed under the license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * To run:
 *
 *   heroku local preview
 *
 * then open http://localhost:5000
 *
 */

/* jshint node: true, devel: true */
'use strict'

const cloudinary = require('cloudinary')
const express = require('express')
const busboy = require('express-busboy')
const fs = require('fs')
const memer = require('./memer')

const IMAGE_ID_FILE = '.memer-preview-image-id'

var app = express()

app.set('port', process.env.PORT || 5000)
app.set('view engine', 'pug')
app.use('/static', express.static('public'))

busboy.extend(app, { upload: true })

function getImageId () {
  try {
    return fs.readFileSync(IMAGE_ID_FILE)
  } catch (e) {
    return null
  }
}

function setImageid (image_id) {
  fs.writeFile(IMAGE_ID_FILE, image_id, function (err) {
    if (err) {
      console.error('On writing image ID to file: ' + err)
    }
  })
}

app.get('/', function (req, res) {
  res.render('index', {})
})

app.get('/meme', function (req, res) {
  var image_id = getImageId()
  var top_text = decodeURIComponent(req.query['top-text'])
  var bottom_text = decodeURIComponent(req.query['bottom-text'])
  if (image_id && image_id.length > 0) {
    var transformed_url = memer.getMemeUrl(
      image_id,
      top_text,
      bottom_text
    )
    res.status(200).send({
      image_url: transformed_url
    })
  } else {
    res.status(400).send({
      error: 'Missing image-id parameter'
    })
  }
})

app.post('/upload-image', function (req, res) {
  var old_image_id = getImageId()
  if (old_image_id && old_image_id.length > 0) {
    console.log('Deleting image ID: ' + old_image_id)
    cloudinary.v2.api.delete_resources(
      [old_image_id],
      function (error, result) {
        if (error) {
          console.error('On deleting images: %s', error.message)
        } else {
          console.log(result)
        }
      }
    )
  }
  cloudinary.v2.uploader.upload(
    req.files.image.file,
    function (error, result) {
      var cloudinary_url = result.secure_url
      if (cloudinary_url !== null) {
        console.log('Uploaded image with public ID ' +
          result.public_id +
          ', URL: ' + result.url)
        setImageid(result.public_id)
      } else {
        console.error('[ERROR] On uploading file: %s', error)
      }
      res.redirect('/')
    }
  )
})

// Start server
// Webhooks must be available via SSL with a certificate signed by a valid
// certificate authority.
app.listen(app.get('port'), function () {
  console.log('Node app is running on port', app.get('port'))
})

module.exports = app
