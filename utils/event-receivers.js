const express = require('express');
const Sequelize = require('sequelize');
const models = require('../models/index');
const User = models.User;
const Book = models.Book;
const Checkout = models.Checkout;
const Waitlist = models.Waitlist;
const Hold = models.Hold;
const winston = require('winston');
const moment = require('moment');
const _ = require('underscore');
const crypto = require('crypto');
const config = require('../config/config');
const utils = require('../utils/util');
const mailer = require('../utils/email');
const events = require('events');
const eventEmitter = new events.EventEmitter();
const Op = Sequelize.Op;


let onBookAvailable = (book)=>{
    winston.info("Event received. Book available..",book.title);
    winston.info("Now checking waitlist for..",book.title);

    Waitlist.findOne({
        where:{
            bookId:book.id
        }
    }).
    then((w)=>{
        if(w){
            winston.info("Waitlist entry exists for ..",book.title);
            let patronList = w.get('patronList');
            w.set('patronList',null);
            if(patronList && patronList.length > 0){
                let firstInQueue = patronList[0];
                /* let endDate = new Date();
                endDate.setDate(endDate.getDate() + 3); */
                let endDate = moment().add(global.timeOffset,'minutes');
                endDate = endDate.add(3,'days').toDate();
                winston.info("Creating hold for patron..",firstInQueue);
                Hold.create({
                    bookId:book.id,
                    patronId:firstInQueue.patronId,
                    startDate: moment().add(global.timeOffset,'minutes').toDate(),//new Date(),
                    endDate:endDate,
                    isActive:true
                }).
                then((hold)=>{
                    if(hold){
                        winston.info("hold created for patron..",firstInQueue);
                        //update the waitlist
                        winston.info("updating waitlist...");
                        
                        patronList.shift();
                        winston.info("updating waitlist...",patronList);
                        w.set('patronList',patronList);
                        w.save()
                        .then((w1)=>{
                            //update the book count
                            winston.info("updating book count...");
                            Book.update(
                                { 
                                    numAvailableCopies: models.sequelize.literal('num_available_copies -1') 
                                },
                                {
                                    where: {
                                        id:book.id
                                }
                            }).
                            then((updatedRecords)=>{
                                if(updatedRecords){
                                    winston.info("Book count updated...");
                                    winston.info("Job done...send email");
                                    User.findOne({
                                        where:{
                                            id:firstInQueue.patronId
                                        }
                                    })
                                    .then((user)=>{
                                        //remove book from waitlist for this user
                                        if(user && user!==null){
                                            let waitlistedBooks = user.get("waitListBookIds");
                                            waitlistedBooks.splice( waitlistedBooks.indexOf(book.id), 1 );
                                            user.set("waitListBookIds",null);
                                            user.set("waitListBookIds",waitlistedBooks);
                                            user.save().then((u)=>{
                                                winston.info("user waitlist updated..");
                                            });
                                        }
                                        
                                        // mail user about the book availability;
                                        utils.sendBookAvailableMail(book,user,hold);
                                    });
                                    
                                }
                            })
                        });
                        
                    }
                })
            }
            else{
                winston.info("No patrons on waitlist for ..",book.title);
                updateBookQuantity(book);
            }
        }
        else{
            //no waitlist hence increase the book count
            updateBookQuantity(book);
        }
    })
}

let updateBookQuantity = (book)=>{
    Book.update(
        { // increment available count
            numAvailableCopies: models.sequelize.literal('num_available_copies +1') 
        },
        {
            where: {
                id:book.id
        }
    })
    .then((b)=>{
        if(b && b!==null){
            winston.info("Book updated...",b[0]);
        }
    });
}


exports.onBookAvailable = onBookAvailable;