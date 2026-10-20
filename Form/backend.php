<?php
// backend.php

// Check if the request is a POST request
if ($_SERVER['REQUEST_METHOD'] === 'POST') {

    // Check if form data is set
    if (isset($_POST['username']) && isset($_POST['email'])) {
        
        // Get the form data
        $username = htmlspecialchars($_POST['username']);
        $email = htmlspecialchars($_POST['email']);
        
        // For the sake of this example, we're just echoing the received data
        // In a real-world scenario, you could store this in a database or perform validation.
        
        // Simulate a success response (JSON format)
        $response = array(
            'status' => 'success',
            'message' => 'Form submitted successfully!',
            'data' => array(
                'username' => $username,
                'email' => $email
            )
        );

        // Send a JSON response back to the frontend
        header('Content-Type: application/json');
        echo json_encode($response);
    } else {
        // If required fields are missing, send an error response
        $response = array(
            'status' => 'error',
            'message' => 'Missing form data.'
        );
        header('Content-Type: application/json');
        echo json_encode($response);
    }
} else {
    // If the request is not POST, return an error response
    $response = array(
        'status' => 'error',
        'message' => 'Invalid request method.'
    );
    header('Content-Type: application/json');
    echo json_encode($response);
}
?>
