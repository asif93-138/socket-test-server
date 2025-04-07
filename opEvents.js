import mongoose from "mongoose";

const UserSchema = new mongoose.Schema({
  user_id: { type: String, required: true },
  gender: { type: String, required: true },
  interested: { type: String, required: true },
});

const OpEventSchema = new mongoose.Schema(
  {
    event_id: { type: String, required: true },
    event_time: { type: String, required: true },
    waiting_room: { type: Object, default: { M: [], F:[] } },
    dating_room: { type: [Object], default: [] },
    call_history: { type: [[String]], default: [] }, // Array of arrays of strings
    matched: { type: [[String]], default: [] }, // Array of arrays of strings
  },
  { timestamps: true }
);

const OpEvent = mongoose.model("OpEvent", OpEventSchema);

export default OpEvent;
