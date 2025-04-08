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
  const event_id = socket.handshake.query.event_id;
  const user_id = socket.handshake.query.user_id;
  const gender = socket.handshake.query.gender;
  const interested = socket.handshake.query.interested;
  socket.event_id = event_id; 
  socket.user_id = user_id; 
  socket.gender = gender; 
  socket.interested = interested; 
  console.log('Client connected:', socket.id);

  socket.on('join_event', (event_id) => {
    socket.join(event_id);
    console.log(`User ${socket.id} joined event room ${event_id}`);
  });

  socket.on("switch_room", ({ from, to }) => {
    socket.leave(from);
    socket.join(to);
    console.log(`Socket ${socket.id} switched from ${from} to room ${to}`);
  });

  socket.on('disconnect', () => {
    const event_id = socket.event_id;
    const user_id = socket.user_id;
    const gender = socket.gender;
    const interested = socket.interested;
    disconnectUser(event_id, {user_id, gender, interested})
    console.log('Client disconnected:', socket.id);
  });
});

async function disconnectUser(event_id, user) {
  console.log('- disconnectUser Function started -');
  console.log(event_id);
  console.log(user);
  const result = await OpEvent.findOne({ event_id: event_id });

  await leaveDatingRoom(event_id, user.user_id);
  await eventLeaving({event_id, user});
  console.log('- disconnectUser Function ended -');
}

app.post('/join', async (req, res) => {
  eventJoining(req, res);
});

function hasTimePassedPlus3Hours(datetimeStr) {
  // Parse input string to local time
  const [datePart, timePart] = datetimeStr.split('T');
  const [year, month, day] = datePart.split('-').map(Number);
  const [hour, minute] = timePart.split(':').map(Number);
  
  // Create local Date object
  const originalDate = new Date(year, month - 1, day, hour, minute);
  
  // Add 3 hours
  const futureDate = new Date(originalDate.getTime() + 3 * 60 * 60 * 1000);

  // Format adjusted date to "YYYY-MM-DDTHH:mm"
  const formatDateLocal = (date) => {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    const h = String(date.getHours()).padStart(2, '0');
    const min = String(date.getMinutes()).padStart(2, '0');
    return `${y}-${m}-${d}T${h}:${min}`;
  };

  const adjustedTime = formatDateLocal(futureDate);
  const now = new Date();
  const hasPassed = now > futureDate;

  return {
    adjustedTime,
    hasPassed
  };
}

async function eventJoining(req, res) {
  console.log('----- JOIN STARTED -----');
  console.log(req.body);
  const { event_id, user } = req.body;
  const result = await OpEvent.findOne({ event_id: event_id });
  if (!result) {
    try {
      const eventTime = hasTimePassedPlus3Hours("2025-04-08T15:00").adjustedTime;

      if (hasTimePassedPlus3Hours("2025-04-08T15:00").hasPassed) {
        res.status(410).json({message: "event ended!"});
        return;
      }

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

      console.log(`----- updated waiting_room array of ${user.gender} -----`);
      console.log(updatedResult);
      res.send({ user_id: user.user_id, event_time: result.event_time });
    } catch (error) {
      console.error(error);
      res.status(500).send('Server Error');
    }
  }
  res.on('finish', () => {
    pairingFunction(user, event_id);
  });

  console.log('----- JOIN ENDED -----');
}

app.post('/confirmDate', async (req, res) => {
  console.log('----- CONFIRM DATE STARTED -----');
  console.log(req.body);

  const { dateRoomId, event_id, userData, pair } = req.body;

  const result = await OpEvent.findOne({ event_id: event_id });

  let indexM, indexF;

  if (userData.gender === "M") {
    result.waiting_room.M.forEach((obj, index) => {
      if (obj.user_id === userData.user_id) {
        indexM = index;
      }
    })
    const updatedArrM = result.waiting_room.M.toSpliced(indexM, 1); // Add support for MMFF
    const updateResult = await OpEvent.findByIdAndUpdate(result._id, { waiting_room: { M: updatedArrM , F: result.waiting_room.F } });
  } else {
    result.waiting_room.F.forEach((obj, index) => {
      if (obj.user_id === userData.user_id) {
        indexF = index;
      }
    })
    const updatedArrF = result.waiting_room.F.toSpliced(indexF, 1); // Add support for MMFF
    const updateResult = await OpEvent.findByIdAndUpdate(result._id, { waiting_room: { M: result.waiting_room.M , F: updatedArrF } });
  }

  let arr;

  //add
  let updateWithThisIndex = -1;
  if (result.dating_room.length === 0) {
    arr = { pair, dateRoomId, userData: [userData], extension: [] };
    //update full waiting room value
    //remove from waiting
    const updateResult = await OpEvent.findByIdAndUpdate(result._id, { dating_room: [arr] });
  } else {
    //rem

    result.dating_room.forEach((obj, index) => { //save index (index init at -1)
      if (obj.pair.join() === pair.join()) {
        obj.userData.push(userData)
        arr = obj;
        updateWithThisIndex = index
      }
    })

    if (updateWithThisIndex === -1) {
      //push
      arr = { pair, dateRoomId, userData: [userData], extension: [] };
      const updateResult = await OpEvent.findByIdAndUpdate(result._id, { dating_room: [...result.dating_room, arr] });
    } else {
      //update full waiting room value
      let updatedValue = result.dating_room
      updatedValue[updateWithThisIndex] = arr
      const updateResult = await OpEvent.findByIdAndUpdate(result._id, { dating_room: updatedValue });
    }
  }


  //remove
  if (arr.userData.length > 1) {
    const callHistoryArr = pair.sort();
    const updateResult = await OpEvent.findByIdAndUpdate(result._id, { $push: { call_history: callHistoryArr } });
    broadCastStartCall(dateRoomId);
  }

  console.log('----- CONFIRM DATE ENDED -----');
  //response back with 10s
  res.status(200).json({ message: 10 });

})

function broadCastStartCall(dateRoomId) {
  io.to(dateRoomId).emit("start_date", { timer: 30 });
}

app.put('/leaveDatingRoom', async (req, res) => {
  console.log('--- LEAVE DATING STARTED ---');
  console.log(req.body);

  // await onLeave(req.body.event_id, req.body.user_id, req.body.isDisconnected, res);
  leaveDatingRoom(req.body.event_id, req.body.user_id);
  console.log('--- LEAVE DATING ENDED ---');
  res.json({ message: 'leaving dating room..' });
})

async function leaveDatingRoom(event_id, user_id) {
  console.log('----- leaveDatingRoom function started -----');
  const result = await OpEvent.findOne({ event_id: event_id });
  console.log('----- initial dating_room array -----');
  console.log(result.dating_room);
  let data;
  //conditional
  for (let i = 0; i < result.dating_room.length; i++) {
    if (result.dating_room[i].pair.includes(user_id)) {
      console.log(`[CONNECTED] User ${user_id} leaving dating_room at index ${i} and will join waiting_room`);
      data = result.dating_room[i];
      // leaveDating and joinWaiting logic here
      const updatedArr = result.dating_room.toSpliced(i, 1);
      console.log('----- updated dating_room array -----');
      console.log(updatedArr);

      const updatedResult = await OpEvent.findOneAndUpdate(
        { event_id: event_id },
        { dating_room: updatedArr }
      );

      // emit
      io.to(data.dateRoomId).emit("has_left", "done!");

      break;
    }
  }
  // call [join - pairing - if pair match
  // response
  console.log('----- leaveDatingRoom function ended -----');
}

app.delete("/leave_event", async (req, res) => {
  console.log('--- Req Body of leave_event api ---');
  console.log(req.body);
  console.log('--- Req Body of leave_event api ---');
  eventLeaving(req.body);
  res.json({message: 'event left!'});
});

async function eventLeaving(params) {
  console.log('--- eventLeaving function started ---');
  console.log(params);
  const result = await OpEvent.findOne({ event_id: params.event_id });
  if (params.user.gender === 'M') {
    for (let i = 0; i < result.waiting_room.M.length; i ++) {
      if (result.waiting_room.M[i].user_id === params.user.user_id) {
        const updatedArr = result.waiting_room.M.toSpliced(i, 1);
        const updateResult = await OpEvent.findByIdAndUpdate(result._id, { waiting_room: { M: updatedArr, F: result.waiting_room.F } });
        return;
      }
    }
  } else {
    for (let i = 0; i < result.waiting_room.F.length; i ++) {
      console.log(result.waiting_room.F[i].user_id, params.user.user_id);
      if (result.waiting_room.F[i].user_id === params.user.user_id) {
        const updatedArr = result.waiting_room.F.toSpliced(i, 1);
        const updateResult = await OpEvent.findByIdAndUpdate(result._id, { waiting_room: { M: result.waiting_room.M, F: updatedArr } });
        return;
      }
    }
  }
  console.log('--- eventLeaving function ended ---');
}

app.put('/extend', async (req, res) => {
  console.log('--- req.body of /extend api ---');
  console.log(req.body);
  console.log('--- req.body of /extend api ---');
  const {user_id, dateRoomId, event_id} = req.body;
  const result = await OpEvent.findOne({ event_id: event_id });
  for (let i = 0; i < result.dating_room.length; i ++) {
    if (result.dating_room[i].dateRoomId === dateRoomId && !result.dating_room[i].extension.includes(user_id)) {
      const data = result.dating_room[i];
      const updatedArr = result.dating_room[i].extension;
      updatedArr.push(user_id);
      data.extension = updatedArr;
      const dataArr = result.dating_room;
      dataArr[i] = data;
      const updateResult = await OpEvent.findByIdAndUpdate(result._id, { dating_room: dataArr });
      if (updatedArr.length === 2) {
        io.to(dateRoomId).emit("clicked");
        // push to new column
        const updateResult = await OpEvent.findByIdAndUpdate(result._id, { $push: { matched: updatedArr.sort() } });
        res.json({message: 'both party have extended'});
      } else {
        io.to(dateRoomId).emit("extend_request", { user_id });
        res.json({message: 'waiting for your partner'});
      }
    }
  }
});

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

  let contFlag = false
  
  for (let i = 0; i < interestedGenderArray.length; i++) {

    const selectedUser = interestedGenderArray[i];

    if (selectedUser.user_id === user_id) contFlag = true;


    for (let i = 0; i < result.call_history.length; i++) {
      if (result.call_history[i].join() === [user.user_id, selectedUser.user_id].sort().join()) {
        contFlag = true
        break;
      }
    }
    if(contFlag) continue;
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