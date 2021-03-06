define(function(require) {
    var $               = require('jquery'),
        _               = require('underscore'),
        Backbone        = require('backbone'),
        Post            = require('models/post'),
        Feed            = require('views/feed'),
        FeedSelector    = require('views/feedSelector'),
        RoomT           = require('text!templates/room.html'),
        PostFormT       = require('text!templates/postForm.html'),
        UserT           = require('text!templates/userListUser.html'),
        Vents           = require('vents/vents');

    Room = Backbone.View.extend({
        tagName: 'div',
        className: 'room',
        template: _.template(RoomT),
        
        events: {
            'click .submit': 'submit'
        },
        
        initialize: function (args) {
            var s = this;
    
            // using simple array as the collection for now
            s.posts = [];   
            
            // hash for tracking feed views
            s.feeds = [];

            // hash for tracking selector views
            s.selectors = [];

            // bool used to check if user has seen feed
            s.focused = 1;

            // grab user info
            s.user = args.user;

            // intialize lastMessage
            s.lastMessage = {
                _id: 0
            }

            // grab room and add class
            s.room = args.room;
            s.$el.addClass(s.room+'View');
            s.$el.attr('id',s.room);

            s.$el.append(this.template());
            
            // create initial feeds
            s.mainFeed = s.addFeed('main',1);
            s.linkFeed = s.addFeed('links'); 
            s.codeFeed = s.addFeed('code'); 

            // add main feed and add a post form
            //s.$('.feeds').prepend( s.mainFeed.el );
            s.mainFeed.$el.append(_.template(PostFormT)());
            
            //add event listener
            window.socket.on(s.room, function (data) {

                // console.log('recieved data: ');
                // console.log(data);
                
                if(data.type == 'init') {
                    
                    _.each(data.posts.reverse(), function(message,index) {
                        if(index == data.posts.length-1) {
                            s.process(message,{noScroll: 0});
                        }
                        else {
                            s.process(message,{noScroll: 1});
                        }
                    });
                }
                else {
                    s.process(data);
                }
            });

            s.$('.input').keypress(function (e) {
                if (e.keyCode == 13 && s.$('#checkbox').prop('checked') == 1) {
                    s.submit();
                }
            });

            // listen for focused event to check if new receipt needs to go out
            Vents.on('focused',_.bind(s.focus,s));
            Vents.on('blurred',_.bind(s.unFocus,s));
        },
        focus: function () {
            var s = this;
            s.focused = 1;
            console.log("focus");
            s.addUserToReceipt();
        },
        unFocus: function () {
            var s = this;
            s.focused = 0;
        },
        submit: function () {
            var s = this;

            //collect data
            var data = s.$('.input').val();
            
            // strip whitespace with sanitize function
            data = s.sanitize(data);

            // if some content exists, send it
            if(data != '') {

                // build message block
                var message = {
                    type: 'content',
                    text: data,
                    username: s.user.name,
                    room: s.room,
                    email: s.user.email
                }

                // set out message to roomates
                window.socket.emit(s.room,message);

                // clear input value
                s.$('.input').val('');

                // clear receipt
                s.clearReceipt();

                // submit on enter adds a new line due to debouncing issues
                // this small delay lets the space get deleted 1ms later.
                setTimeout(function() {
                    s.$('.input').val('');
                },1);

            }
        },
        process: function (message,options) {
            var s = this;
    
            if(message.type == 'content') {
    
                s.addPost(message,options); 
            }
            else if(message.type == 'action') {
    
                s.action(message);
    
            }
    
        },
        // Adds an incoming post to the rooms feeds
        addPost: function (message,options) {
            var s = this;
            
            //make a model
            var post = new Post(message);
            
            // Save model in posts array by _id
            s.posts[message._id] = post;

            //render and append post
            s.mainFeed.post(post,options);
    
            // check for links
            var links = message.text.match(/((https?:\/\/)?([\da-z-]+[\.])+([a-z]{2,4})(\/[\w\da-z\-^\/\.]*)+\/?)/g)? 1 : 0;
            
            if(links) {
                s.linkFeed.post(post,options);
            }

            // check for code
            var code = message.text.match(/```/g);

            if(code && code.length >= 2) {
                code = 1;
            } else {
                code = 0;
            }
            
            if(code) {
                message.text = message.text.replace(/```/,'<pre><code>');
                message.text = message.text.replace(/```/,'</code></pre>');
            
                post.set('text', message.text);

                code = s.codeFeed.post(post,options);
                
                code.$('.content pre code').each(function() {
                        hljs.highlightBlock(this, '    ');
                        //hljs.highlightAuto(this.textContent);
                });

            }
    
            // check for hash tags
            var tags = message.text.match(/#([\S]+)/g);
            
            _.each(tags, function (tag) {
                tag = tag.substr(1, tag.length-1);
                if(s.selectors[tag]) {
                    s.feeds[tag].post(post);
                } else {
                    s.addFeed(tag);
                    s.feeds[tag].post(post);
                }
            });

            // update latest message id
            s.lastMessage = message;
            s.clearReceipt();
            s.addUserToReceipt();
        },
        action: function (message) {
            var s = this;
  
            // a user has joined the room
            if(message.action == 'join') {
                
                console.log('join');
                
                console.log(message.text);
                // ERROR: sometimes its null
                if(message.text && message.text.user) {
                    // add user to user list    
                    s.$('.userList').append(_.template(UserT)({data: message.text.user}));
                }

            } 
            // a user has left the room 
            else if(message.action == 'leave') {

                // find and remove user from list
                var selector = '.userList #'+message.text.user.name+message.text.user.hash;
                s.$(selector).remove();

            } 
            // the action is related to a post
            else {
                
                // the text of an action message is the relevant post's _id
                // grab relevant post
                var post = s.posts[message.text];

                if(post) {
                    if(message.action == 'delete') {

                        // set deleted, this will fire model change and the post 
                        // will re-render into a deleted content state
                        // also clear out the text
                        post.set({'deleted': 1, 'text': ''});

                    } else if (message.action == 'receipt') {

                        // addToReceipt handles receipt updates
                        s.addToReceipt(message);
                    }
                    
                }
            }
        },
        // this function adds a new feed (for a hashtag)
        addFeed: function (name,primary) {
            var s = this;
         
            var feed = new Feed({name: name});

            if(primary) {
                s.$('.feeds').prepend( feed.el );
                feed.$el.addClass('show');
            } else {
                if(!s.selectors[name]) {

                    // add a new selector
                    var selector = new FeedSelector({name: name, room: s});
                    s.$('.feedSelectors').append( selector.el );

                    // add feed to secondary list
                    s.$('.secondary').append( feed.el );

                    // save feed to feed hash
                    s.feeds[name] = feed;

                    //save to selector hash
                    s.selectors[name] = selector;
                }
            }
            return feed;
        },
        sanitize: function (str) {

            function trim(str, chars) {
                    return ltrim(rtrim(str, chars), chars);
            }
             
            function ltrim(str, chars) {
                    chars = chars || "\\s";
                        return str.replace(new RegExp("^[" + chars + "]+", "g"), "");
            }
             
            function rtrim(str, chars) {
                    chars = chars || "\\s";
                        return str.replace(new RegExp("[" + chars + "]+$", "g"), "");
            }

            return trim(str);
        },
        addUserToReceipt: function () {
            var s = this;

            if( (s.$el.css('display') != 'none') && 
                 s.focused &&
                (s.lastMessageSeen != s.lastMessage._id) && 
                (s.user.name != s.lastMessage.username) ) {
               
                // build message block
                var message = {
                    type: 'action',
                    action: 'receipt',
                    text: s.lastMessage._id,
                    username: s.user.name,
                    room: s.room,
                    email: s.user.email
                }

                // set out message to roomates
                window.socket.emit(s.room,message);
                
                s.lastMessageSeen = s.lastMessage._id;
            }

        },
        addToReceipt: function (message) {
            var s = this;
          
            // if the receipt is for the current last message and
            // the message is not from self
            if((message.text == s.lastMessage._id) && (message.email != s.user.email)) {

                // if user has not been recorded
                if(s.receiptUsers[message.email] != message.text) {

                    // record user
                    s.receiptUsers[message.email] = message.text;

                    //update receipt

                    // if receipt is empty add this user
                    if(s.emptyReceipt) {

                        // add the user to receipt
                        s.mainFeed.$('.receipt').text('Seen by ' + message.username); 
                       
                        // receipt is no longer empty
                        s.emptyReceipt = 0;
                        
                    } else {

                        // if the receipt is not empty append the user
                        s.mainFeed.$('.receipt').text(
                            s.mainFeed.$('.receipt').text() + ', ' + message.username
                        );
                    }

                }

                // if the incoming receipts text which contains the taget messages id 
                // is not equal to the currently recorded last message then reset receipt
            } else if(message.text != s.lastMessage._id) {
                
                // clear the receipt
                s.clearReceipt();
            }

        },
        clearReceipt: function () {
            var s = this;

            // reset the receiptUsers hash
            s.receiptUsers = [];

            // reset the receipt text
            s.mainFeed.$('.receipt').text('');

            // reset the empty receipt flag
            s.emptyReceipt = 1;
        }

    });

    return Room;

});
