/** Maps a raw error to a safe, user-facing message + status code. */
export function errorHandler(err, req, res, _next) {
  console.error(err); // full detail goes to server logs only

  if (err.status && err.publicMessage) {
    return res.status(err.status).json({ error: err.publicMessage });
  }

  if (err.code === "23505") return res.status(409).json({ error: "That record already exists." });
  if (err.code === "23503") return res.status(409).json({ error: "This record is referenced elsewhere and cannot be changed." });
  if (err.name === "ZodError") return res.status(400).json({ error: "Invalid input.", details: err.issues });

  return res.status(500).json({ error: "Something went wrong. Please try again." });
}

export function notFound(req, res) {
  res.status(404).json({ error: "Not found." });
}

export class HttpError extends Error {
  constructor(status, publicMessage) {
    super(publicMessage);
    this.status = status;
    this.publicMessage = publicMessage;
  }
}
