// A second, smaller way to use what this repo already does.
// Kept separate from src/admin_service.ts so the main path stays as short as it was.
// Reads INFRAI_API_KEY from the environment, same as the main example.
const key = process.env.INFRAI_API_KEY;
if (!key) throw new Error("set INFRAI_API_KEY first");
console.log("key loaded; reuse the helper from the main example here");
