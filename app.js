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

const bodyParser = require('body-parser')
const cloudinary = require('cloudinary')
const config = require('config')
const crypto = require('crypto')
const express = require('express')
const redis = require('redis')
const request = require('request')

const memer = require('./memer')

const CLOUDINARY_PUBLIC_ID_KEY = 'cloudinary_public_id'
const POSITION_TO_GRAVITY = {
  top: 'north',
  bottom: 'south'
}
const STOCK_IMAGE_PREFIX = 'stock/'
const STRINGS_KEY = 'strings'

// Used to differentiate user uploads from other images
const USER_UPLOAD_TAG = 'user-upload'

var redisClient = redis.createClient(process.env.REDISCLOUD_URL, {no_ready_check: true})

var app = express()

app.set('port', process.env.PORT || 5000)
app.set('view engine', 'pug')
app.use(bodyParser.json({ verify: verifyRequestSignature }))
app.use(express.static('public'))

/*
 * Be sure to setup your config values before running this code. You can
 * set them using environment variables or modifying the config file in /config.
 *
 */

// App Secret can be retrieved from the App Dashboard
const APP_SECRET = (process.env.MESSENGER_APP_SECRET)
  ? process.env.MESSENGER_APP_SECRET
  : config.get('appSecret')

// Arbitrary value used to validate a webhook
const VALIDATION_TOKEN = (process.env.MESSENGER_VALIDATION_TOKEN)
  ? (process.env.MESSENGER_VALIDATION_TOKEN)
  : config.get('validationToken')

// Generate a page access token for your page from the App Dashboard
const PAGE_ACCESS_TOKEN = (process.env.MESSENGER_PAGE_ACCESS_TOKEN)
  ? (process.env.MESSENGER_PAGE_ACCESS_TOKEN)
  : config.get('pageAccessToken')

if (!(APP_SECRET && VALIDATION_TOKEN && PAGE_ACCESS_TOKEN)) {
  console.error('Missing config values')
  process.exit(1)
}

/*
 * Use your own validation token. Check that the token used in the Webhook
 * setup is the same token used here.
 *
 */
app.get('/webhook', function (req, res) {
  if (req.query['hub.mode'] === 'subscribe' &&
      req.query['hub.verify_token'] === VALIDATION_TOKEN) {
    console.log('Validating webhook')
    res.status(200).send(req.query['hub.challenge'])
  } else {
    console.error('Failed validation. Make sure the validation tokens match.')
    res.sendStatus(403)
  }
})

/*
 * All callbacks for Messenger are POST-ed. They will be sent to the same
 * webhook. Be sure to subscribe your app to your page to receive callbacks
 * for your page.
 * https://developers.facebook.com/docs/messenger-platform/implementation#subscribe_app_pages
 *
 */
app.post('/webhook', function (req, res) {
  var data = req.body
  if (!data) {
    res.status(400).send('Unable to parse request body')
    return
  }

  // Make sure this is a page subscription
  if (data.object === 'page') {
    // Iterate over each entry
    // There may be multiple if batched
    data.entry.forEach(function (pageEntry) {
      // Iterate over each messaging event
      pageEntry.messaging.forEach(function (messagingEvent) {
        if (messagingEvent.optin) {
          receivedAuthentication(messagingEvent)
        } else if (messagingEvent.message) {
          receivedMessage(messagingEvent)
        } else if (messagingEvent.delivery) {
          receivedDeliveryConfirmation(messagingEvent)
        } else if (messagingEvent.postback) {
          receivedPostback(messagingEvent)
        } else {
          console.log('Webhook received unknown messagingEvent: ', messagingEvent)
        }
      })
    })

    // Assume all went well.
    //
    // You must send back a 200, within 20 seconds, to let us know you've
    // successfully received the callback. Otherwise, the request will time out.
    res.sendStatus(200)
  } else {
    res.status(400).send({
      message: 'Unexpected data object found',
      expected: 'page',
      received: String(data.object)
    })
  }
})

/*
 * Verify that the callback came from Facebook. Using the App Secret from
 * the App Dashboard, we can verify the signature that is sent with each
 * callback in the x-hub-signature field, located in the header.
 *
 * https://developers.facebook.com/docs/graph-api/webhooks#setup
 *
 */
function verifyRequestSignature (req, res, buf) {
  var signature = req.headers['x-hub-signature']

  if (!signature) {
    // For testing, let's log an error. In production, you should throw an
    // error.
    console.error('Couldn\'t validate the signature.')
  } else {
    var elements = signature.split('=')
    var signatureHash = elements[1]

    var expectedHash = crypto.createHmac('sha1', APP_SECRET)
                        .update(buf)
                        .digest('hex')

    if (signatureHash !== expectedHash) {
      throw new Error('Couldn\'t validate the request signature.')
    }
  }
}

/*
 * Authorization Event
 *
 * The value for 'optin.ref' is defined in the entry point. For the 'Send to
 * Messenger' plugin, it is the 'data-ref' field. Read more at
 * https://developers.facebook.com/docs/messenger-platform/webhook-reference#auth
 *
 */
function receivedAuthentication (event) {
  var senderID = event.sender.id
  var recipientID = event.recipient.id
  var timeOfAuth = event.timestamp

  // The 'ref' field is set in the 'Send to Messenger' plugin, in the 'data-ref'
  // The developer can set this to an arbitrary value to associate the
  // authentication callback with the 'Send to Messenger' click event. This is
  // a way to do account linking when the user clicks the 'Send to Messenger'
  // plugin.
  var passThroughParam = event.optin.ref

  console.log('Received authentication for user %d and page %d with pass ' +
    'through param \'%s\' at %d', senderID, recipientID, passThroughParam,
    timeOfAuth)

  // When an authentication is received, we'll send a message back to the sender
  // to let them know it was successful.
  sendTextMessage(senderID, 'Authentication successful')
}

function parseCommand (string) {
  string = string.trim()
  var spaceIndex = string.indexOf(' ')
  if (spaceIndex > 0) {
    var command = string.substr(0, spaceIndex).toLocaleLowerCase()
    var args = string.substr(spaceIndex + 1)
    return {command: command, args: args}
  }
  return {command: string.toLocaleLowerCase(), args: null}
}

/*
 * Message Event
 *
 * This event is called when a message is sent to your page. The 'message'
 * object format can vary depending on the kind of message that was received.
 * Read more at https://developers.facebook.com/docs/messenger-platform/webhook-reference#received_message
 *
 * For this example, we're going to echo any text that we get. If we get some
 * special keywords ('button', 'generic', 'receipt'), then we'll send back
 * examples of those bubbles to illustrate the special message bubbles we've
 * created. If we receive a message with an attachment (image, video, audio),
 * then we'll simply confirm that we've received the attachment.
 *
 */
function receivedMessage (event) {
  var senderID = event.sender.id
  var recipientID = event.recipient.id
  var timeOfMessage = event.timestamp
  var message = event.message

  console.log('Received message for user %d and page %d at %d with message: ',
    senderID, recipientID, timeOfMessage)
  console.log(JSON.stringify(message))

  // You may get a text or attachment but not both
  var messageText = message.text
  var messageAttachments = message.attachments

  if (messageText) {
    var parseResult = parseCommand(messageText)
    var command = parseResult.command.replace(/\W/g, '')
    if (POSITION_TO_GRAVITY[command]) {
      sendMemedImage(senderID, command, parseResult.args)
    } else if (command === 'stock') {
      setStockImage(senderID, parseResult.args)
    } else if (command === 'help') {
      sendHelpMessage(senderID)
    } else if (command === 'hello') {
      sendHelpMessage(senderID, 'Hello yourself!')
    } else if (command === 'hi') {
      sendHelpMessage(senderID, 'Oh, hi!')
    } else {
      sendHelpMessage(senderID,
        'Hmm, I don\'t know what that means.')
    }
  } else if (messageAttachments) {
    var first_attachment = messageAttachments[0]
    if (first_attachment.type === 'image') {
      var image_url = first_attachment.payload.url
      cloudinary.v2.uploader.upload(
        image_url,
        {
          tags: [USER_UPLOAD_TAG]
        },
        function (error, result) {
          var cloudinary_url = result.secure_url
          if (cloudinary_url !== null) {
            sendTextMessage(senderID, 'Image received! ' +
              'Now use \'top <text>\' or \'bottom <text>\' to add text.')

            // It's intentional that we overwrite existing text config here.
            // New image, new text, right?
            var newConfig = {}
            newConfig[CLOUDINARY_PUBLIC_ID_KEY] = result.public_id
            redisClient.set(senderID, JSON.stringify(newConfig))
            console.log('Uploaded image with public ID ' +
              result.public_id +
              ', URL: ' + result.url)
          } else {
            sendTextMessage(senderID, 'Error uploading image: ' + error)
          }
        }
      )
    }
  }
}

function setStockImage (senderID, imageID) {
  if (imageID && imageID.length > 0) {
    var currentConfig = {}
    currentConfig[CLOUDINARY_PUBLIC_ID_KEY] = 'stock/' + imageID
    redisClient.set(senderID, JSON.stringify(currentConfig))

    // Let them see what they chose
    var transformed_url = memer.getMemeUrl(currentConfig[CLOUDINARY_PUBLIC_ID_KEY])
    sendImageMessage(senderID, transformed_url)
  } else {
    (function (sndrID){
      cloudinary.v2.api.resources(
        {
          type: 'upload',
          prefix: STOCK_IMAGE_PREFIX,
          max_results: 100
        },
        function (error, result) {
          if (error) {
            console.error(error.message)
          } else {
            var image_ids = []
            for (var resource of result.resources) {
              // do something with resource.public_id,
              var image_id = resource.public_id.substring(
                STOCK_IMAGE_PREFIX.length
              )
              image_ids.push(image_id)
            }
            image_ids.sort()
            var output = 'Choose from:\n'
            for (var image_id of image_ids) {
              output = output + '\n' + image_id
            }
            sendTextMessage(sndrID, output)
          }
        }
      )
    }(senderID))
  }
}

function sendMemedImage (senderID, position, message) {
  (function (sndrID, pos, msg) {
    redisClient.get(sndrID, function (err, reply) {
      console.log('redis get result: ' + reply)
      console.log('redis get error: ' + err)

      var currentConfig = {}
      if (reply !== null) {
        currentConfig = JSON.parse(reply)
      }

      console.log('Current config: ' + JSON.stringify(currentConfig))

      if (!(CLOUDINARY_PUBLIC_ID_KEY in currentConfig)) {
        console.log('Couldn\'t find ' + CLOUDINARY_PUBLIC_ID_KEY + ' in ' + JSON.stringify(currentConfig))
        sendHelpMessage(sndrID, 'You need to upload an image first.')
        return
      }

      if (!(STRINGS_KEY in currentConfig)) {
        currentConfig[STRINGS_KEY] = {}
      }

      if (msg) {
        console.log('Adding \'' + msg + '\' to position: ' + pos)
        currentConfig[STRINGS_KEY][pos] = msg
      } else {
        console.log('Deleting message from position: ' + pos)
        delete currentConfig[STRINGS_KEY][pos]
      }

      console.log('currentConfig: ' + JSON.stringify(currentConfig))

      var strings = currentConfig[STRINGS_KEY]

      var transformed_url = memer.getMemeUrl(
        currentConfig[CLOUDINARY_PUBLIC_ID_KEY],
        strings['top'],
        strings['bottom']
      )
      sendImageMessage(senderID, transformed_url)

      // Update the current currentConfig
      redisClient.set(senderID, JSON.stringify(currentConfig))
    })
  }(senderID, position, message))
}

/*
 * Delivery Confirmation Event
 *
 * This event is sent to confirm the delivery of a message. Read more about
 * these fields at https://developers.facebook.com/docs/messenger-platform/webhook-reference#message_delivery
 *
 */
function receivedDeliveryConfirmation (event) {
  var delivery = event.delivery
  var messageIDs = delivery.mids
  var watermark = delivery.watermark

  if (messageIDs) {
    messageIDs.forEach(function (messageID) {
      console.log('Received delivery confirmation for message ID: %s',
        messageID)
    })
  }

  console.log('All message before %d were delivered.', watermark)
}

/*
 * Postback Event
 *
 * This event is called when a postback is tapped on a Structured Message. Read
 * more at https://developers.facebook.com/docs/messenger-platform/webhook-reference#postback
 *
 */
function receivedPostback (event) {
  var senderID = event.sender.id
  var recipientID = event.recipient.id
  var timeOfPostback = event.timestamp

  // The 'payload' param is a developer-defined field which is set in a postback
  // button for Structured Messages.
  var payload = event.postback.payload

  console.log('Received postback for user %d and page %d with payload \'%s\' ' +
    'at %d', senderID, recipientID, payload, timeOfPostback)

  // When a postback is called, we'll send a message back to the sender to
  // let them know it was successful
  sendTextMessage(senderID, 'Postback called')
}

/*
 * Send a message with an using the Send API.
 *
 */
function sendImageMessage (recipientId, image_url) {
  var messageData = {
    recipient: {
      id: recipientId
    },
    message: {
      attachment: {
        type: 'image',
        payload: {
          url: image_url
        }
      }
    }
  }

  callSendAPI(messageData)
}

function sendHelpMessage (recipientId, errorMessage) {
  var output = ''
  if (errorMessage) {
    output = output + errorMessage + '\n\n'
  }
  output = output +
    'Send me an image to get started. Animated GIFs work too!\n\n' +
    'Then send me \'top <text>\' or \'bottom <text>\' to add text.'

  sendTextMessage(recipientId, output)
}

function sendTextMessage (recipientId, messageText) {
  var messageData = {
    recipient: {
      id: recipientId
    },
    message: {
      text: messageText
    }
  }

  callSendAPI(messageData)
}

/*
 * Call the Send API. The message data goes in the body. If successful, we'll
 * get the message id in a response
 *
 */
function callSendAPI (messageData) {
  request({
    json: messageData,
    method: 'POST',
    qs: { access_token: PAGE_ACCESS_TOKEN },
    uri: 'https://graph.facebook.com/v2.6/me/messages'
  }, function (error, response, body) {
    if (!error && response.statusCode === 200) {
      var recipientId = body.recipient_id
      var messageId = body.message_id

      console.log('Successfully sent generic message with id %s to recipient %s',
        messageId, recipientId)
    } else {
      console.error('Unable to send message.')
      console.error(response)
      console.error(error)
    }
  })
}

// Start server
// Webhooks must be available via SSL with a certificate signed by a valid
// certificate authority.
app.listen(app.get('port'), function () {
  console.log('Node app is running on port', app.get('port'))
})

module.exports = app
