var fs = require('fs');
var readline = require('readline');
var google = require('googleapis');
var googleAuth = require('google-auth-library');

var cred;
var globalAuth;

console.log("welcome to gmail controller");

function getLabels(auth, callback) {
  if (auth) {
    listLabels(auth, function(labels) {
      console.log(labels[0]);
      callback(labels);
    });
  } else {
    console.log("ERROR! Cred and/or globalAuth not filled");
    return;
  }
}

function getNumUnread(auth, callback) {
  if (auth) {
    listNumUnread(auth, function(result) {
      callback(result);
    });
  } else {
    console.log("ERROR! oAuth isn't authenticated.");
    return;
  }
}

function authorize(credentials, callback) {
  var clientSecret = credentials.installed.client_secret;
  var clientId = credentials.installed.client_id;
  var redirectUrl = credentials.installed.redirect_uris[0];
  var auth = new googleAuth();
  var oauth2Client = new auth.OAuth2(clientId, clientSecret, redirectUrl);

  // Check if we have previously stored a token.
  fs.readFile(TOKEN_PATH, function(err, token) {
    if (err) {
      getNewToken(oauth2Client, callback);
    } else {
      oauth2Client.credentials = JSON.parse(token);
      callback(oauth2Client);
    }
  });
}

function getNewToken(oauth2Client, callback) {
  var authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES
  });
  console.log('Authorize this app by visiting this url: ', authUrl);
  var rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  rl.question('Enter the code from that page here: ', function(code) {
    rl.close();
    oauth2Client.getToken(code, function(err, token) {
      if (err) {
        console.log('Error while trying to retrieve access token', err);
        return;
      }
      oauth2Client.credentials = token;
      storeToken(token);
      callback(oauth2Client);
    });
  });
}

function storeToken(token) {
  try {
    fs.mkdirSync(TOKEN_DIR);
  } catch (err) {
    if (err.code != 'EEXIST') {
      throw err;
    }
  }
  fs.writeFile(TOKEN_PATH, JSON.stringify(token));
  console.log('Token stored to ' + TOKEN_PATH);
}

function listLabels(auth, callback) {
  var gmail = google.gmail('v1');
  gmail.users.labels.list({
    auth: auth,
    userId: 'me'
    //GET https://www.googleapis.com/gmail/v1/users/userId/labels
  }, function(err, response) {
    if (err) {
      console.log('The API returned an error: ' + err);
      return;
    }
    var labels = response.labels;
    if (labels.length == 0) {
      console.log('No labels found.');
    } else {
      //console.log('Labels:');
      var i = 0;
      var labelList = [];
      while (i < labels.length) {
        var label = labels[i];
        labelList.push(label.name);
        i++;
      }
      callback(labelList);
    }
  });
}

function listNumUnread(auth, callback) {
  var gmail = google.gmail('v1');
  gmail.users.labels.get({
    auth: auth,
    userId: 'me',
    id: 'UNREAD'
  }, function(err, response) {
    if (err) {
      console.log('The API returned an error: ' + err);
      return;
    }
    var numUnread = response.messagesTotal;
    callback(numUnread);
  });
}


function print(auth) {
  globalAuth = auth;
  return;
}

module.exports = {
  //startGmailAPI : startGmailAPI,
  getLabels : getLabels,
  getNumUnread : getNumUnread
}