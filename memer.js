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

const DEFAULT_POSITION = 'bottom'
const OUTPUT_WIDTH = 500
const POSITION_TO_GRAVITY = {
  top: 'north',
  bottom: 'south'
}
const TEXT_PADDING_HORIZONTAL = 10
const TEXT_PADDING_VERTICAL = 25

// Font size constants
const STRING_LENGTH_FACTOR = 20
const WIDTH_MULTIPLIER = 0.25

function getFontSize (string, max_width) {
  var max_font_size = max_width / 12
  var font_size = Math.round(max_width * WIDTH_MULTIPLIER - STRING_LENGTH_FACTOR * Math.log(string.length))
  if (font_size > max_font_size) {
    font_size = max_font_size
  }
  return font_size
}

function getTransform (string, position) {
  var gravity = POSITION_TO_GRAVITY[position]
  if (!gravity) {
    gravity = POSITION_TO_GRAVITY[DEFAULT_POSITION]
  }

  var text_width = OUTPUT_WIDTH - TEXT_PADDING_HORIZONTAL * 2
  var font_size = getFontSize(string, text_width)
  return {
    border: {
      width: Math.ceil(font_size / 8),
      color: 'black'
    },
    color: '#ffffff',
    crop: 'fit',
    gravity: gravity,
    overlay: {
      font_family: 'Impact',
      font_size: font_size,
      stroke: 'stroke',
      text: encodeURIComponent(string.toLocaleUpperCase()),
      text_align: 'center'
    },
    width: text_width,
    y: TEXT_PADDING_VERTICAL
  }
}

function getWatermarkTransform () {
  var text_width = OUTPUT_WIDTH - TEXT_PADDING_HORIZONTAL * 2
  var font_size = Math.ceil(text_width / 24)
  return {
    border: {
      width: 2,
      color: 'black'
    },
    color: '#ffffff',
    crop: 'fit',
    gravity: 'south_east',
    overlay: {
      font_family: 'Helvetica',
      font_size: font_size,
      font_weight: 'bold',
      stroke: 'stroke',
      text: 'm.me/memerbot'
    },
    width: text_width,
    x: 5,
    y: 5
  }
}

exports.getMemeUrl = (cloudinary_public_id, top_string, bottom_string) => {
  var transforms = [
    { width: OUTPUT_WIDTH }
  ]

  var should_show_watermark = false

  if (top_string && top_string.length > 0) {
    transforms.push(getTransform(top_string, 'top'))
    should_show_watermark = true
  }

  if (bottom_string && bottom_string.length > 0) {
    transforms.push(getTransform(bottom_string, 'bottom'))
    should_show_watermark = true
  }

  if (should_show_watermark) {
    transforms.push(getWatermarkTransform())
  }

  var transformed_url = cloudinary.url(cloudinary_public_id, {
    transformation: transforms
  })

  console.log('Got transformed URL: %s', transformed_url)

  return transformed_url
}
