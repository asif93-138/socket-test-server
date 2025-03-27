import express, { json } from 'express';
import { createServer } from 'http';
import cors from 'cors';
import { Server } from "socket.io";
import connectDB from './dbConfig.js';
import OpEvent from './opEvents.js';

const app = express();
app.use(json());
connectDB();

// Allow CORS for your frontend origin.
app.use(cors({
  origin: '*',
}));

const server = createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ["GET", "POST"]
  }
});

io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  socket.on('join_event', (event_id) => {
    socket.join(event_id);
    console.log(`User ${socket.id} joined event room ${event_id}`);
  });

  socket.on("switch_room", (dateRoomId) => {
    socket.join(dateRoomId);
    console.log(`Socket ${socket.id} switched to room ${dateRoomId}`);
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
});


app.get('/', (req, res) => {
  res.send('Server is running');
});

app.post('/join', async (req, res) => {
  console.log('----- Request Body (/join) -----');
  console.log(req.body);
  console.log('----- Request Body (/join) -----');
  const { event_id, user } = req.body;
  const result = await OpEvent.findOne({ event_id: event_id });
  if (!result) {
    try {
      const eventTime = "2025-03-24T18:00";

      const data = {
        event_id: event_id,
        event_time: eventTime,
        waiting_room: {
          M: user.gender === "M" ? [user] : [],
          F: user.gender === "F" ? [user] : []
        },
        dating_room: [],
        call_history: [],
      };
      const insertedResult = await OpEvent.create(data);
      res.send({ user_id: user.user_id, event_time: eventTime });
    } catch (error) {
      console.error(error);
      res.status(500).send('Server Error');
    }
  } else {
    try {
      const updatedResult = await OpEvent.findOneAndUpdate(
        { event_id: event_id },
        { $push: { [`waiting_room.${user.gender}`]: user } }, //
        { new: true }
      );
      res.send({ user_id: user.user_id, event_time: result.event_time });
    } catch (error) {
      console.error(error);
      res.status(500).send('Server Error');
    }
  }
  res.on('finish', () => {
    pairingFunction(user, event_id);
  });
});

function complementaryGender(gender) {
  if (gender === "M") {
    return "F";
  } else if (gender === "F") {
    return "M";
  }
}

app.post('/confirmDate', async (req, res) => {
  console.log('----- Request Body (/confirmDate) -----');
  console.log(req.body);
  console.log('----- Request Body (/confirmDate) -----');
  const {dateRoomId, event_id, userData, pair} = req.body;
  const result = await OpEvent.findOne({ event_id: event_id });
  let arr;
  let updateWithThisIndex = -1;
  if (result.dating_room.length === 0) {
    arr = {pair, dateRoomId, userData: [userData]};
    //update full waiting room value
    const updateResult = await OpEvent.findByIdAndUpdate(result._id, {dating_room: [arr]});
  } else {
    
    result.dating_room.forEach((obj, index) => { //save index (index init at -1)
      if (obj.pair.join() === pair.join()) {
        obj.userData.push(userData)
        arr = obj;
        updateWithThisIndex = index
      }
    })

    if(updateWithThisIndex === -1){
      //push
      arr = {pair, dateRoomId, userData: [userData]};
      const updateResult = await OpEvent.findByIdAndUpdate(result._id, {dating_room: [...result.dating_room, arr]});
    }else{
      //update full waiting room value
      let updatedValue = result.dating_room
      updatedValue[updateWithThisIndex] = arr
      const updateResult = await OpEvent.findByIdAndUpdate(result._id, {dating_room: updatedValue});
    }
  }
 

  // if arr.userdata.length >1 {  THIS IS A FUNC
  // push to history
  // remove from waiting room
  // BROADCAST TO dateRoomId TO START CALL with TIME,}
  if (arr.userData.length > 1) {
    const callHistoryArr = pair.sort();
    let updatedArrM = result.waiting_room.M, updatedArrF = result.waiting_room.F;
    let indexListM = [], indexListF = [];
    result.waiting_room.M.forEach((obj, index) => {
      if (obj.user_id === arr.userData[0].user_id || obj.user_id === arr.userData[1].user_id) {
        indexListM.push(index);
      }
    })
    result.waiting_room.F.forEach((obj, index) => {
      if (obj.user_id === arr.userData[0].user_id || obj.user_id === arr.userData[1].user_id) {
        indexListF.push(index);
      }
    })
    if (indexListM.length > 0) {
      updatedArrM  = result.waiting_room.M.toSpliced(indexListM[0], 1); // Add support for MMFF
    }
    if (indexListF.length > 0) {
      updatedArrF  = result.waiting_room.F.toSpliced(indexListF[0], 1); // Add support for MMFF
    }
    const updateResult = await OpEvent.findByIdAndUpdate(result._id, {waiting_room: {M: updatedArrM, F: updatedArrF}, $push: { call_history: callHistoryArr  }});
    broadCastStartCall(dateRoomId);
  }
  

  //response back with 10s
  res.status(200).json({message: 10});
})

function broadCastStartCall(dateRoomId) {
  io.to(dateRoomId).emit("start_date", {timer: 30});
}

// async function pairingFunction(user, event_id) {
//   const user_id = user.user_id;
//   const result = await OpEvent.findOne({ event_id: event_id });
//   const interestedIn = user.interested; // complementaryGender(user.gender)
//   if (result && result.waiting_room.length < 2) return;
//   const interestedGenderArray = result.waiting_room[interestedIn];
//   for (let i = 0; i < interestedGenderArray.length; i++) {
//     const selectedUser = interestedGenderArray[i];
//     if(selectedUser.user_id === user_id) continue
//     if(selectedUser.interested === user.gender){
//       //match

//       // io.to("eventid").payload({pair: [uid1, uid2].sort(), dateRoomId: "sadasdas"})
//       console.log("match found", user_id, selectedUser.user_id)
//       return
//     }
//   }
//   return

// }

async function pairingFunction(user, event_id) {
  console.log('----- Running pairing function -----');
  console.log(user, event_id);
  console.log('----- Running pairing function -----');
  const user_id = user.user_id;
  const result = await OpEvent.findOne({ event_id: event_id });
  console.log('----- query result from database -----');
  console.log(result);
  console.log('----- query result from database -----');
  const interestedIn = user.interested;
  console.log('interestedIn :', interestedIn);
  const interestedGenderArray = result.waiting_room[interestedIn];

  console.log('----- interestedGenderArray -----');
  console.log(interestedGenderArray);
  console.log('----- interestedGenderArray -----');

  if (!result || interestedGenderArray.length === 0) return;
  for (let i = 0; i <result.call_history.length; i++){
    if( result.call_history[i].includes(user.user_id)){
      return;
    }
  }
  for (let i = 0; i < interestedGenderArray.length; i++) {
    const selectedUser = interestedGenderArray[i];
    if (selectedUser.user_id === user_id) continue;

    if (selectedUser.interested === user.gender) {
      const dateRoomId = `${event_id}-${user_id}-${selectedUser.user_id}`;
      console.log("Match found:", user_id, selectedUser.user_id);
      console.log('----- socket emission from pairing function -----');
      console.log({
        pair: [user_id, selectedUser.user_id].sort(),
        userData: [user, selectedUser],
        dateRoomId,
      });
      console.log('----- socket emission from pairing function -----');
      // Emit match event to all users in the event room
      io.to(event_id).emit("match_found", {
        pair: [user_id, selectedUser.user_id].sort(),
        userData: [user, selectedUser],
        dateRoomId,
      });
      return;
    }
  }
}

const PORT = process.env.PORT || 3001;
server.listen(PORT, "0.0.0.0", () => console.log(`Server running on port ${PORT}`));