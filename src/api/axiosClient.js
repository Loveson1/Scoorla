// src/api/axiosClient.js
import axios from 'axios';

const axiosClient = axios.create({
  baseURL: 'https://dummyjson.com', // base for all requests
  headers: { 'Content-Type': 'application/json' },
  timeout: 10000,
});

export default axiosClient;


