#include<iostream>
using namespace std;

int main(){
    int n = 4; // Height of the diamond
    int width = 2 * n - 1; // Width of the diamond

    // Top half of the diamond
    for (int i = 0; i < n; i++) {
        for (int j = 0; j < width; j++) {
            // Print '*' at the positions forming the border of the diamond
            if (j == n - i - 1 || j == n + i - 1) {
                cout << "*";
            } else {
                cout << " ";
            }
        }
        cout << endl; // Move to the next line after each row
    }

    // Bottom half of the diamond
    for (int i = n - 2; i >= 0; i--) {
        for (int j = 0; j < width; j++) {
            // Print '*' at the positions forming the border of the diamond
            if (j == n - i - 1 || j == n + i - 1) {
                cout << "*";
            } else {
                cout << " ";
            }
        }
        cout << endl; // Move to the next line after each row
    }

    return 0; // End of the program
}


// #include<iostream>
// using namespace std;
// int main(){
//   int n = 4; 
//   int num = 0;
//   //top
//   for (int i = 0; i<n; i++){
//     //spaces 1
//     for(int j = 0; j<n-i-1; j++){
//       cout<<" ";
//     }
//     cout<<"*";
//     for(int q = i; q>0; q-- ){
//       cout<<" ";
//     }
//     for(int q = i-1; q>0; q-- ){
//       cout<<" ";
//     }
//     if(i>0){
//       cout<<"*";
//     }
//     cout<<endl;
//   }
//   //bottom
//   for (int i = n-1; i>=0; i--){
//     //spaces 1
//     for(int j = 0; j<n-i-1; j++){
//       cout<<" ";
//     }
//     cout<<"*";
//     for(int q = i; q>0; q-- ){
//       cout<<" ";
//     }
//     for(int q = i-1; q>0; q-- ){
//       cout<<" ";
//     }
//     if(i>0){
//       cout<<"*";
//     }
//     cout<<endl;
//   }
  
//   return 0;
// }

