import express, { json } from 'express';
import { createServer } from 'http';
import cors from 'cors';
import { Server } from "socket.io";
import connectDB from './dbConfig.js';
import OpEvent from './opEvents.js';

const app = express();
app.use(json());
await connectDB();

// Allow CORS for your frontend origin.
app.use(cors());

// {
//   origin: '*',
// }

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

  socket.on("switch_room", ({from, to}) => {
    socket.leave(from);
    socket.join(to);
    console.log(`Socket ${socket.id} switched from ${from} to room ${to}`);
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
      const eventTime = "2025-04-06T18:00";

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

app.post('/confirmDate', async (req, res) => {
  console.log('----- Request Body (/confirmDate) -----');
  console.log(req.body);
  console.log('----- Request Body (/confirmDate) -----');
  const {dateRoomId, event_id, userData, pair} = req.body;
  const result = await OpEvent.findOne({ event_id: event_id });
  let arr;
  let updateWithThisIndex = -1;
  if (result.dating_room.length === 0) {
    arr = {pair, dateRoomId, userData: [userData], extension: []};
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
      arr = {pair, dateRoomId, userData: [userData], extension: []};
      const updateResult = await OpEvent.findByIdAndUpdate(result._id, {dating_room: [...result.dating_room, arr]});
    }else{
      //update full waiting room value
      let updatedValue = result.dating_room
      updatedValue[updateWithThisIndex] = arr
      const updateResult = await OpEvent.findByIdAndUpdate(result._id, {dating_room: updatedValue});
    }
  }
 
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

app.put('/updateDatingRoom', async (req, res) => {
  console.log('--- testing updateDatingRoom api ---');
  console.log(req.body);
  console.log('--- testing updateDatingRoom api ---');
  // await onLeave(req.body.event_id, req.body.user_id, req.body.isDisconnected, res);
  await leaveDatingRoom(req.body.event_id, req.body.user_id);
  res.json({ message: 'leaving dating room..' });
})

async function onLeave(event_id, user_id, isDisconnected, res) {
  try {
    const result = await OpEvent.findOne({ event_id: event_id });

    if (!result) {
      console.log(`[onLeave] No event found for event_id: ${event_id}`);
      return res.status(404).json({ message: 'Event not found' });
    }

    if (isDisconnected) {
      for (let i = 0; i < result.dating_room.length; i++) {
        if (result.dating_room[i].pair.includes(user_id)) {
          console.log(`[DISCONNECTED] User ${user_id} leaving dating_room at index ${i}`);
          // leaveDating logic here

          break;
        }
      }

      for (let i = 0; i < result.waiting_room.M.length; i++) {
        if (result.waiting_room.M[i].user_id === user_id) {
          console.log(`[DISCONNECTED] User ${user_id} found in waiting_room.M at index ${i}`);
          // leaveWaiting logic here
          break;
        }
      }

      for (let i = 0; i < result.waiting_room.F.length; i++) {
        if (result.waiting_room.F[i].user_id === user_id) {
          console.log(`[DISCONNECTED] User ${user_id} found in waiting_room.F at index ${i}`);
          // leaveWaiting logic here
          break;
        }
      }
    } else {
      for (let i = 0; i < result.dating_room.length; i++) {
        if (result.dating_room[i].pair.includes(user_id)) {
          console.log(`[CONNECTED] User ${user_id} leaving dating_room at index ${i} and will join waiting_room`);
          // leaveDating and joinWaiting logic here
          break;
        }
      }

      for (let i = 0; i < result.waiting_room.M.length; i++) {
        if (result.waiting_room.M[i].user_id === user_id) {
          console.log(`[CONNECTED] User ${user_id} found in waiting_room.M at index ${i}`);
          // leaveWaiting logic here
          break;
        }
      }

      for (let i = 0; i < result.waiting_room.F.length; i++) {
        if (result.waiting_room.F[i].user_id === user_id) {
          console.log(`[CONNECTED] User ${user_id} found in waiting_room.F at index ${i}`);
          // leaveWaiting logic here
          break;
        }
      }
    }

    res.json({ message: 'Processed onLeave logic' });
  } catch (err) {
    console.error(`[onLeave] Error processing event_id: ${event_id}, user_id: ${user_id}`, err);
    res.status(500).json({ error: 'Internal server error' });
  }
}

async function leaveDatingRoom(event_id, user_id) {
  console.log('----- leaveDatingRoom function started -----');
  const result = await OpEvent.findOne({ event_id: event_id });
  console.log('----- initial dating_room array -----');
  console.log(result.dating_room);

  //conditional
  for (let i = 0; i < result.dating_room.length; i++) {
    if (result.dating_room[i].pair.includes(user_id)) {
      console.log(`[CONNECTED] User ${user_id} leaving dating_room at index ${i} and will join waiting_room`);
      // leaveDating and joinWaiting logic here
      const updatedArr  = result.dating_room.toSpliced(i, 1);
      console.log('----- updated dating_room array -----');
      console.log(updatedArr);
      const updatedResult = await OpEvent.findOneAndUpdate(
        { event_id: event_id },
        { dating_room: updatedArr }
      );
      break;
    }
  }
  // call [join - pairing - if pair match
  // response
  console.log('----- leaveDatingRoom function ended -----');
}

async function pairingFunction(user, event_id) {
  console.log('----- Arguments of pairing function -----');
  console.log(user, event_id);
  console.log('----- Arguments of pairing function -----');
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
  for (let i = 0; i < result.call_history.length; i++){
    if(result.call_history[i].includes(user.user_id)){
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