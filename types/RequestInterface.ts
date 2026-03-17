import express from 'express';

export interface RequestInterface extends express.Request {
  // Additional custom request properties can be added here
}