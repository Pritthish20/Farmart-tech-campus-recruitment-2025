import fs from 'fs';
import path from 'path';
import { Worker, isMainThread, parentPort, workerData } from 'worker_threads';
import { fileURLToPath } from 'url';


// Setup paths for ES Modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Function to process a chunk of the log file.
 * @param {string} chunkData - A chunk of the log file.
 * @param {string} targetDate - The target date to filter logs by.
 * @returns {string[]} - Array of logs matching the target date.
 */
function processChunk(chunkData, targetDate) {
  const logs = [];
  const lines = chunkData.split('\n');

  // Filter the lines for the target date
  for (let line of lines) {
    if (line.startsWith(targetDate)) {
      logs.push(line);
    }
  }

  return logs;
}

/**
 * Worker thread to process a log chunk.
 */
if (!isMainThread) {
  const { chunkData, targetDate } = workerData;
  const result = processChunk(chunkData, targetDate);
  parentPort.postMessage(result); // Send result back to main thread
} else {
  /**
   * Main function to extract logs for a specific date using chunk-based parallel processing.
   * @param {string} logFilePath - Path to the log file.
   * @param {string} targetDate - The date to search for in the logs (format: YYYY-MM-DD).
   * @returns {Promise<void>} - Logs will be written to the output file.
   */
  async function extractLogsForDate(logFilePath, targetDate) {
    const outputPath = path.join(__dirname, `output/output_${targetDate}.txt`);

    // Ensure the output directory exists
    await fs.promises.mkdir(path.dirname(outputPath), { recursive: true });

    const fileStats = await fs.promises.stat(logFilePath);
    const fileSize = fileStats.size;
    const chunkSize = 10 * 1024 * 1024; // 10 MB per chunk
    const chunkCount = Math.ceil(fileSize / chunkSize);

    const workers = [];
    let chunkStart = 0;
    let matchCount = 0;
    const writeStream = fs.createWriteStream(outputPath);

    // Process file in chunks using worker threads
    for (let i = 0; i < chunkCount; i++) {
      const chunkEnd = Math.min(chunkStart + chunkSize, fileSize);
      const buffer = Buffer.alloc(chunkEnd - chunkStart);

      const fd = await fs.promises.open(logFilePath, 'r');
      await fd.read(buffer, 0, buffer.length, chunkStart);

      const chunkData = buffer.toString('utf-8');
      workers.push(
        new Worker(__filename, {
          workerData: { chunkData, targetDate },
        })
      );

      workers[workers.length - 1].on('message', (logs) => {
        logs.forEach((log) => {
          writeStream.write(`${log}\n`);
          matchCount++;
        });
      });

      workers[workers.length - 1].on('error', (err) => {
        console.error('Worker error:', err);
      });

      chunkStart = chunkEnd;
    }

    // Wait for all workers to finish processing
    await Promise.all(workers.map((worker) => new Promise((resolve) => worker.on('exit', resolve))));

    console.log(`Extraction complete. Found ${matchCount} log entries for ${targetDate}.`);
    console.log(`Logs saved to: ${outputPath}`);
  }

  // Get the log file path and target date from the command line
  const logFilePath = 'logs_2024.log'; // Customize as per your log file
  const targetDate = process.argv[2]; // Date in format YYYY-MM-DD

  if (!targetDate) {
    console.error('Please provide a date in the format YYYY-MM-DD');
    process.exit(1);
  }

  extractLogsForDate(logFilePath, targetDate);
}
