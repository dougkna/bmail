var restify = require('restify');
var builder = require('botbuilder');
var Base64 = require('js-base64/base64.js').Base64;

//=========================================================
// Gmail API
//=========================================================
var google = require('googleapis');
var oAuth2  = google.auth.OAuth2;
var scopes  = [
	"https://www.googleapis.com/auth/contacts.readonly",
	"https://www.googleapis.com/auth/userinfo.profile",
	'https://www.googleapis.com/auth/userinfo.email',
	"https://www.googleapis.com/auth/gmail.readonly",
	"https://www.googleapis.com/auth/gmail.compose"
]
var getOAuthClient = function () {
	var oauthClientSecret = CLIENT_SECRET,
		oauthClientId = CLIENT_ID,
		redirectUrl = ["http://localhost:3978/api/oauthcallback","https://botmaildemo.azurewebsites.net/api/oauthcallback"]

	//**********change redirectUrl for local & cloud use**********
	return new oAuth2(oauthClientId, oauthClientSecret, redirectUrl[0]);
};

//=========================================================
// Bot & Server Setup 
//=========================================================

// Setup Restify Server
var server = restify.createServer();
server.use(restify.queryParser());
server.listen(process.env.port || process.env.PORT || 3978, function() {
   console.log('%s listening to %s', server.name, server.url); 
});

var connector = new builder.ChatConnector({
    appId: APP_ID,
    appPassword: APP_PASSWORD
});
var bot = new builder.UniversalBot(connector);

server.post('/api/messages', connector.listen());

server.get("/api/oauthcallback", function (req, res, next) {
	var authCode = req.query.code,
		address = JSON.parse(req.query.state),
		oauth = getOAuthClient();

	oauth.getToken(authCode, function (err, tokens) {
		if (err) {
			console.log("ERROR ::: ", err);
		}
		else if (tokens) {
			bot.beginDialog(address, "/success", tokens);
		}
		res.send("Token sent. You may close this tab now.");
	});
});

//=========================================================
// Bots Dialogs
//=========================================================
var gmail = require('./quickstart');
var tempContactList;


var intents = new builder.IntentDialog();
bot.dialog('/', intents);

intents.matches(/^hello|^hi+|^sup|^hey|^yo/i, [
	function(session){
		session.beginDialog('/ensureProfile', session.userData.profile);
	},
	function (session, results) {
		session.userData.profile = results.response;
		if (session.privateConversationData.tokens && session.userData.profile) {
			session.send('Hi %(id)s!', session.userData.profile);
		}
		else if (session.privateConversationData.tokens && !session.userData.profile) {
				session.send("Hi! Sign up or type help for more.");
		} else if (!session.privateConversationData.tokens && session.userData.profile) {
			session.send("Hi %(id)s! Please log on to gmail.", session.userData.profile);
		} else {
			session.send("Hi! Please log on to gmail, sign up, or type help for more.");
		}
  }
]);

intents.matches(/^help/i, function(session) {
	session.send('First you need to connect to your Gmail-- tell me to log in! You can also command to signup, reset account, etc');
	session.send('Once your gmail is connected, you can ask me things like : unread emails, find contact, all labels, write email.');
});

intents.matches(/^login|^log in|^log on|^sign in|^sign on|^signin/i, [
	function(session) {
		session.beginDialog('/profile', session.userData.profile);
	}
]);

intents.matches(/^signup|^sign up/i, [
	function(session) {
		session.beginDialog('/ensureProfile', session.userData.profile);
	},
	function(session,results) {
		session.userData.profile = results.response;
        session.send('Hello %(id)s! You are signed up.', session.userData.profile);
    }
]);

intents.matches(/^reset account/i, [
    function (session) {
        session.beginDialog('/ensureProfile');
    },
    function (session, results) {
    	session.userData.profile = results.response;
        session.send('Ok... Changed your id to %(id)s and your password to %(pw)s.', session.userData.profile);
    }
]);


//=========================================================
// GMAIL LABELS AND UNREAD EMAILS SEARCH
//=========================================================

intents.matches(/all label(s)?/i, [
	function(session) {
		if (!session.privateConversationData.tokens) {
			session.endDialog("Log on to gmail first.");
			return;
		}
		var oauth = getOAuthClient();
		oauth.setCredentials(session.privateConversationData.tokens);
		session.send("OK");
		gmail.getLabels(oauth, function(label) {
			session.send("HERE: %s", label);
		});
	}
]);

intents.matches(/unread (e)?(g)?mail(s)?/i, [
	function(session) {
		if (!session.privateConversationData.tokens) {
			session.endDialog("Log on to gmail first.");
			return;
		}
		var oauth = getOAuthClient();
		console.log("TOKEN :: ", session.privateConversationData.tokens);
		oauth.setCredentials(session.privateConversationData.tokens);
		session.send("Let's see...");
		gmail.getNumUnread(oauth, function(num) {
			if (num <= 1) {
				session.send("You have %s unread email.", num);
			}
			if (num > 1) {
				session.send("You have %s unread emails.", num);
			}
		});
	}
]);

//=========================================================
// FIND GMAIL CONTACTS AND SEND EMAILS
//=========================================================

intents.matches(/^find contact(s)?/i, [
	function(session){
		if (!session.privateConversationData.tokens) {
			session.endDialog("Log on to gmail first.");
			return;
		}
		builder.Prompts.text(session, "Tell me the name you want to find.");
	},
	function (session, results, next) {
		var contact = results.response;
		getInfoByName(contact, function(nameCount, emailCount, bucket) {
			if (bucket && bucket.length === 0){
				session.send("Found no email under that name.");
			} else {
				session.send("Of the %s matching name(s), %s email(s) found:", nameCount, emailCount);
				var lists = getContactsAttachments(session, bucket);

				var reply = new builder.Message(session);
	    	.attachmentLayout(builder.AttachmentLayout.carousel)
	    	.attachments(lists)

    		session.send(reply);
				//session.send("%s : %s", bucket[i].targetName, bucket[i].targetEmail);
				session.endDialog("If you'd like to send an email, choose a contact from above.");
			}
		});
	}
]);

function getContactsAttachments(session, bucket) {
	var list = [];
	for (var i = 0 ; i < bucket.length ; i++) {
		list.push(
			new builder.HeroCard(session)
				.title(bucket[i].targetName)
	        .subtitle(bucket[i].targetEmail)
	        .buttons([
          		builder.CardAction.dialogAction(session, 'composeEmail', bucket[i].targetEmail, 'Send Message');
      		]);
	        //.buttons(builder.CardAction.openUrl(session, "https://en.wikipedia.org/wiki/EMP_Museum", "Wikipedia"))
	        //.tap(builder.CardAction.dialogAction(session, "composeEmail"), bucket[i].targetEmail)
		);
	}
	return list;
}

intents.matches(/(write)?(send)? (e)?(g)?mail(s)?/i, [
	function (session) {
		if (!session.privateConversationData.tokens) {
			session.endDialog("Log on to gmail first.");
			return;
		}
		builder.Prompts.text(session, "What's the recipient's email address?");
	},
	function(session, results) {
		if (results.response) {
			var temp = {};
			temp.data = results.response;
			session.beginDialog('/compose', temp);
		}
	}
]);

bot.beginDialogAction('composeEmail', '/compose');

bot.dialog('/compose', [
    function (session, args, next) {
    	session.privateConversationData.email = {};
    	session.privateConversationData.email.address = args.data;
        builder.Prompts.text(session, "What will be the title of the email?");
    },
    function (session, results, next) {
    	if (results.response) {
    		session.privateConversationData.email.subject = results.response;
    		builder.Prompts.text(session, 'Now write your message.');
    		console.log("ADD : ", session.privateConversationData.email.address);
    		console.log("SUBJECT : ", session.privateConversationData.email.subject);
    	} else {
    		session.endDialog('Error occurred. Try again.');
    	}
    },
    function (session, results, next) {
    	if (results.response) {
    		session.privateConversationData.email.body = results.response;
    		
    		session.send("Great. Sending out an email . . .");
    		var emailPiece = [];
    		emailPiece.push("To: "+session.privateConversationData.email.address);
    		emailPiece.push('Content-type: text/html;charset=iso-8859-1');
    		emailPiece.push('MIME-Version: 1.0');
    		emailPiece.push("Subject: "+session.privateConversationData.email.subject);
    		emailPiece.push("");
		    emailPiece.push(session.privateConversationData.email.body);

		    var email = emailPiece.join("\r\n").trim();
		    sendMessage(session, 'me', email, function(result) {
    			session.endDialog("Email sent!");
    		});
    	} else {
    		session.endDialog('Error occurred. Try again.');
    	}
    }
]);

function sendMessage(session, userId, email, callback) {
  var base64EncodedEmail = new Buffer(email).toString('base64');
  base64EncodedEmail.replace(/\+/g, '-').replace(/\//g, '_');

  var oauth = getOAuthClient();
  oauth.setCredentials(session.privateConversationData.tokens);
  var base64EncodedEmail = Base64.encodeURI(email);
  var gmail = google.gmail('v1');

  var request = gmail.users.messages.send({
  	auth : oauth,
    'userId': userId,
    'resource': {
      'raw': base64EncodedEmail
    }
  }, function(err, response) {
    if (err) {
		session.send("Sorry, error occurred.");
		console.log('The API returned an error: ' + err);
		return;
    }
    if (response) {
    	callback(response);
    }
  });
}



//=========================================================
// LOGIN TO GMAIL AND RETRIEVE CONTACTS LIST
//=========================================================

bot.dialog("/profile",
	function (session) {
		var oauth = getOAuthClient(),
			url = oauth.generateAuthUrl({ access_type: "online", scope: scopes }) +
				"&state=" + encodeURIComponent(JSON.stringify(session.message.address));

		session.send(new builder.Message(session).addAttachment(
			new builder.SigninCard(session);
				.text("Gmail authentication required :")
				.button("Sign-In", url))
		);
	}
)

bot.dialog("/success", function (session, tokens) {
	var oauth = getOAuthClient();
	var contactsList = []
	session.privateConversationData.tokens = tokens;
	session.send("oAuth Success! Retrieving your contacts. . .");
	oauth.setCredentials(tokens);
	console.log("PRIVATE.TOKEN :: ", session.privateConversationData.tokens)
	console.log("OAUTH ::: ", oauth)
	var pageToken = '';

	getContacts(contactsList, oauth, pageToken, function(list) {
		tempContactList = list;
		session.endDialog("Done!");
	})
})

function getContacts(list, auth, pageToken, cb) {
	var gmail = google.people("v1")
	gmail.people.connections.list({
		auth: auth,
		resourceName : "people/me",
		'requestMask.includeField' : 'person.email_addresses,person.names',
		//'person.email_addresses,person.names',
		pageSize : 500,
		pageToken : pageToken
	}, function(err, response) {
		if (err) {
			console.log('The API returned an error: ' + err);
			return;
		}
		list.push(response.connections);
		
		if (response.nextPageToken){
			pageToken = response.nextPageToken;
			getContacts(list, auth, pageToken, cb);
		} else {
			console.log("DONE scraping contacts!!");
			cb(list);
		}
	})
	//FULL NAME : response.connections[0].names[0].displayName
	//EMAIL : response.connections[0].emailAddresses[0].value
	//https://www.google.com/m8/feeds/contacts/{userEmail}/full
	//GET https://people.googleapis.com/v1/{resourceName=people/*}
	//GET https://people.googleapis.com/v1/{resourceName=people/*}/connections
}

function getInfoByName(name, cb) {
	var nameCount = 0;
	var emailCount = 0;
	var bucket = [];
	if(tempContactList) {
		for (var i = 0 ; i < tempContactList.length; i++) {
			for (var j = 0 ; j < tempContactList[i].length ; j++) {
				if (tempContactList[i][j].names && tempContactList[i][j].names[0].displayName) {
					var targetName = tempContactList[i][j].names[0].displayName
					if (targetName.toLowerCase().indexOf(name.toLowerCase()) >= 0 ) {
							if (tempContactList[i][j].emailAddresses && tempContactList[i][j].emailAddresses[0].value) {
								var targetEmail = tempContactList[i][j].emailAddresses[0].value;
								bucket.push({
									targetName : targetName,
									targetEmail : targetEmail
								})
								emailCount++;
							}
						nameCount++;
					}
				}
			}
		}
		console.log("TOTAL NAME FOUND : ", nameCount)
		cb(nameCount, emailCount, bucket);
	}
}




//=========================================================
// OTHER BOT COMMANDS
//=========================================================


intents.onDefault(function (session) {
    session.send("I didn't understand. Type 'help' for more.");
});

// bot.dialog('/introduce'), function(session){
// 	session.send('You can command to signup, login, reset account, etc')
// }

bot.dialog('/ensureProfile', [
    function (session, args, next) {
        session.dialogData.profile = args || {};
        if (!session.dialogData.profile.id) {
            builder.Prompts.text(session, "Hey, type an ID you want to use.");
        } else {
            next();
        }
    },
    function (session, results, next) {
        if (results.response) {
            session.dialogData.profile.id = results.response;
        }
        if (!session.dialogData.profile.pw) {
            builder.Prompts.text(session, "And type your password. Don't forget it...");
        } else {
            next();
        }
    },
    function (session, results) {
        if (results.response) {
            session.dialogData.profile.pw = results.response;
        }
        session.endDialogWithResult({ response: session.dialogData.profile });
    }
]);

bot.dialog('/input name', [
	function (session, args, next) {
        session.dialogData.key = args || {};
        if (!session.dialogData.key.approved) {
        	builder.Prompts.text(session, "Type your ID :");
        } else {
            next();
        }	
    },
    function (session, results, next) {
    	if (!session.dialogData.key.approved) {
	    	if (results.response === session.userData.profile.id) {
	    		builder.Prompts.text(session, "Type your password :");
	    	} else {
	    		session.send("ID does not exist -_-")
	    	}
	    } else {
	    	next();
	    }
    },
    function (session, results) {
        if (!session.dialogData.key.approved) {
	        if (results.response === session.userData.profile.pw) {
	        	console.log("kyle")
	        	session.dialogData.key.approved = results.response;
	    		builder.Prompts.text(session, "Login successful!");
	    		session.endDialogWithResult({ response: session.dialogData.key });
	    	} else {
	    		session.send("Wrong password -_-");
	    	}
	    } else {
	    	session.endDialogWithResult({ response: session.dialogData.key });
	    }   	
    }
]);





